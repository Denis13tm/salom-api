import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DriverOperationalStatus,
  EarningsLedgerType,
  Prisma,
  TripStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type CommissionSplit = {
  gross: Prisma.Decimal;
  commission: Prisma.Decimal;
  net: Prisma.Decimal;
  rateBps: number;
};

type LedgerTx = Prisma.TransactionClient;

type WalletMutationResult = {
  ledgerId: string;
  previousBalance: Prisma.Decimal;
  newBalance: Prisma.Decimal;
};

/**
 * So‘m butun: komissiya yaxlitlash 1 so‘m aniqligida.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * platform ulushi: DB `PlatformSettings` yoki `PLATFORM_COMMISSION_BPS` (1000 = 10%).
   */
  splitGrossUzsInt(grossUzs: number, rateBps?: number): CommissionSplit {
    const resolved =
      rateBps ?? this.config.get<number>("PLATFORM_COMMISSION_BPS", 1000);
    const clampBps = Math.max(0, Math.min(10_000, resolved));
    const g = Math.max(0, Math.round(grossUzs));
    const commissionInt = Math.min(g, Math.round((g * clampBps) / 10_000));
    const netInt = g - commissionInt;
    return {
      gross: new Prisma.Decimal(g),
      commission: new Prisma.Decimal(commissionInt),
      net: new Prisma.Decimal(netInt),
      rateBps: clampBps,
    };
  }

  async resolveCommissionBps(): Promise<number> {
    const envDefault = this.config.get<number>("PLATFORM_COMMISSION_BPS", 1000);
    const row = await this.prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: { platformCommissionBps: true },
    });
    const raw = row?.platformCommissionBps ?? envDefault;
    return Math.max(0, Math.min(10_000, raw));
  }

  /**
   * Komissiya hamyoni: env fallback + `PlatformSettings` (admin sozlamalari).
   * `low` har doim `min` dan kichik bo‘lmasligi uchun normalize qilinadi.
   */
  async resolveCommissionWalletThresholds(): Promise<{
    minBroadcastBalanceUzs: number;
    lowBalanceUzs: number;
  }> {
    const envMin = this.config.get<number>(
      "COMMISSION_WALLET_MIN_BROADCAST_BALANCE_UZS",
      10_000,
    );
    const envLow = this.config.get<number>(
      "COMMISSION_WALLET_LOW_BALANCE_UZS",
      30_000,
    );
    const row = await this.prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: {
        commissionWalletMinBroadcastBalanceUzs: true,
        commissionWalletLowBalanceUzs: true,
      },
    });
    let min = row?.commissionWalletMinBroadcastBalanceUzs ?? envMin;
    let low = row?.commissionWalletLowBalanceUzs ?? envLow;
    min = Math.max(0, Math.min(50_000_000, Math.trunc(min)));
    low = Math.max(0, Math.min(50_000_000, Math.trunc(low)));
    if (low < min) low = min;
    return { minBroadcastBalanceUzs: min, lowBalanceUzs: low };
  }

  async splitGrossUzsIntAsync(grossUzs: number): Promise<CommissionSplit> {
    const bps = await this.resolveCommissionBps();
    return this.splitGrossUzsInt(grossUzs, bps);
  }

  private amount(value: number, label = "amountUzs"): Prisma.Decimal {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new BadRequestException(`${label} butun so'm bo'lishi kerak`);
    }
    return new Prisma.Decimal(value);
  }

  private async driverBalanceOrThrow(tx: LedgerTx, driverId: string) {
    const driver = await tx.driver.findUnique({
      where: { id: driverId },
      select: { balanceUzs: true },
    });
    if (!driver) {
      throw new NotFoundException("Driver not found");
    }
    return driver.balanceUzs;
  }

  /**
   * Wallet source-of-truth write path: every cached balance mutation creates a ledger row
   * in the same DB transaction.
   */
  async recordTopUp(
    tx: LedgerTx,
    input: { driverId: string; amountUzs: number; note?: string | null },
  ): Promise<WalletMutationResult> {
    const amt = this.amount(input.amountUzs);
    if (amt.lte(0)) {
      throw new BadRequestException("Top-up miqdori musbat bo‘lishi kerak");
    }
    const previousBalance = await this.driverBalanceOrThrow(tx, input.driverId);
    const newBalance = previousBalance.add(amt);
    await tx.driver.update({
      where: { id: input.driverId },
      data: { balanceUzs: newBalance },
    });
    const ledger = await tx.earningsLedger.create({
      data: {
        driverId: input.driverId,
        type: EarningsLedgerType.TOP_UP,
        amountUzs: amt,
        balanceAfterUzs: newBalance,
        note: input.note?.trim() || "Admin TOP_UP",
      },
    });
    return { ledgerId: ledger.id, previousBalance, newBalance };
  }

  async recordPayout(
    tx: LedgerTx,
    input: { driverId: string; amountUzs: number; note?: string | null },
  ): Promise<WalletMutationResult> {
    const amt = this.amount(input.amountUzs);
    if (amt.lte(0)) {
      throw new BadRequestException("Payout miqdori musbat bo‘lishi kerak");
    }
    const previousBalance = await this.driverBalanceOrThrow(tx, input.driverId);
    if (previousBalance.lt(amt)) {
      throw new BadRequestException(
        "Balans yetarli emas (payout > joriy balans)",
      );
    }
    const newBalance = previousBalance.sub(amt);
    await tx.driver.update({
      where: { id: input.driverId },
      data: { balanceUzs: newBalance },
    });
    const ledger = await tx.earningsLedger.create({
      data: {
        driverId: input.driverId,
        type: EarningsLedgerType.PAYOUT,
        amountUzs: amt,
        balanceAfterUzs: newBalance,
        note: input.note?.trim() || "Admin PAYOUT",
      },
    });
    return { ledgerId: ledger.id, previousBalance, newBalance };
  }

  async recordManualAdjustment(
    tx: LedgerTx,
    input: {
      driverId: string;
      amountUzs: number;
      note?: string | null;
      allowNegative?: boolean;
    },
  ): Promise<WalletMutationResult & { type: EarningsLedgerType }> {
    if (input.amountUzs === 0) {
      throw new BadRequestException("Miqdori 0 bo‘lmasin");
    }
    const delta = this.amount(input.amountUzs);
    const type =
      input.amountUzs > 0
        ? EarningsLedgerType.MANUAL_ADJUSTMENT_PLUS
        : EarningsLedgerType.MANUAL_ADJUSTMENT_MINUS;
    const previousBalance = await this.driverBalanceOrThrow(tx, input.driverId);
    const newBalance = previousBalance.add(delta);
    if (!input.allowNegative && newBalance.lt(0)) {
      throw new BadRequestException(
        "Natijaviy balans manfiy bo'lishi mumkin emas",
      );
    }
    await tx.driver.update({
      where: { id: input.driverId },
      data: { balanceUzs: newBalance },
    });
    const ledger = await tx.earningsLedger.create({
      data: {
        driverId: input.driverId,
        type,
        amountUzs: delta.abs(),
        balanceAfterUzs: newBalance,
        note: input.note?.trim() || `Admin ${type}`,
      },
    });
    return { ledgerId: ledger.id, previousBalance, newBalance, type };
  }

  async recordTripCompletion(
    tx: LedgerTx,
    input: {
      driverId: string;
      orderId: string;
      tripId: string;
      split: CommissionSplit;
    },
  ): Promise<WalletMutationResult> {
    const previousBalance = await this.driverBalanceOrThrow(tx, input.driverId);
    const newBalance = previousBalance.sub(input.split.commission);
    await tx.driver.update({
      where: { id: input.driverId },
      data: {
        operationalStatus: DriverOperationalStatus.ONLINE_IDLE,
        balanceUzs: newBalance,
      },
    });
    await tx.commissionLedger.create({
      data: {
        orderId: input.orderId,
        tripId: input.tripId,
        amountUzs: input.split.commission,
        rateBps: input.split.rateBps,
        note: "Platform commission (bps)",
      },
    });
    await tx.earningsLedger.create({
      data: {
        driverId: input.driverId,
        type: EarningsLedgerType.TRIP_EARNINGS,
        amountUzs: input.split.gross,
        balanceAfterUzs: previousBalance,
        orderId: input.orderId,
        tripId: input.tripId,
        note: "Passenger cash/gross fare collected by driver",
      },
    });
    const ledger = await tx.earningsLedger.create({
      data: {
        driverId: input.driverId,
        type: EarningsLedgerType.TRIP_COMMISSION_DEBIT,
        amountUzs: input.split.commission,
        balanceAfterUzs: newBalance,
        orderId: input.orderId,
        tripId: input.tripId,
        note: `Commission wallet debit (${input.split.rateBps} bps)`,
      },
    });
    return { ledgerId: ledger.id, previousBalance, newBalance };
  }

  async reconcileDriverBalance(driverId: string) {
    const [driver, rows] = await Promise.all([
      this.prisma.driver.findUnique({
        where: { id: driverId },
        select: {
          id: true,
          balanceUzs: true,
          user: { select: { phone: true } },
        },
      }),
      this.prisma.earningsLedger.findMany({
        where: { driverId },
        select: { type: true, amountUzs: true },
      }),
    ]);
    if (!driver) {
      throw new NotFoundException("Driver not found");
    }
    const zero = new Prisma.Decimal(0);
    const ledgerBalance = rows.reduce((sum, row) => {
      switch (row.type) {
        case EarningsLedgerType.TOP_UP:
        case EarningsLedgerType.MANUAL_ADJUSTMENT_PLUS:
        case EarningsLedgerType.REFUND:
        case EarningsLedgerType.BONUS:
        case EarningsLedgerType.BONUS_CREDIT:
          return sum.add(row.amountUzs);
        case EarningsLedgerType.PAYOUT:
        case EarningsLedgerType.TRIP_COMMISSION_DEBIT:
        case EarningsLedgerType.MANUAL_ADJUSTMENT_MINUS:
        case EarningsLedgerType.SUBSCRIPTION_FEE:
          return sum.sub(row.amountUzs);
        case EarningsLedgerType.ADJUSTMENT:
          return sum.add(row.amountUzs);
        default:
          return sum;
      }
    }, zero);
    const drift = driver.balanceUzs.sub(ledgerBalance);
    return {
      driverId,
      phone: driver.user.phone,
      cachedBalanceUzs: driver.balanceUzs.toString(),
      ledgerBalanceUzs: ledgerBalance.toString(),
      driftUzs: drift.toString(),
      ok: drift.eq(0),
    };
  }

  async getDriverBalance(driverId: string) {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { balanceUzs: true },
    });
    const { minBroadcastBalanceUzs: minForOrders, lowBalanceUzs: low } =
      await this.resolveCommissionWalletThresholds();
    if (!d) {
      return {
        balanceUzs: "0",
        minRequiredUzs: String(minForOrders),
        lowBalanceThresholdUzs: String(low),
        status: "blocked",
      };
    }
    const n = Number(d.balanceUzs);
    return {
      balanceUzs: d.balanceUzs.toString(),
      minRequiredUzs: String(minForOrders),
      lowBalanceThresholdUzs: String(low),
      status: n < minForOrders ? "blocked" : n < low ? "low" : "ok",
    };
  }

  async listEarningsForDriver(driverId: string, limit: number) {
    const rows = await this.prisma.earningsLedger.findMany({
      where: { driverId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        order: {
          select: { id: true, pickupLandmark: true, customerPhone: true },
        },
        trip: { select: { id: true, status: true, endedAt: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amountUzs: r.amountUzs.toString(),
        balanceAfterUzs: r.balanceAfterUzs?.toString() ?? null,
        orderId: r.orderId,
        tripId: r.tripId,
        createdAt: r.createdAt.toISOString(),
        note: r.note,
        order: r.order,
        trip: r.trip,
      })),
    };
  }

  /**
   * Haydovchi mobil: joriy balans + oynadagi (UTC) ledger yig‘indilari turi bo‘yicha.
   * PAYOUT — tizimda musbat saqlanadi (yechildi hajmi).
   */
  async getDriverFinanceSummary(driverId: string, days: number) {
    const w = Math.min(Math.max(days, 1), 90);
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - w);
    from.setUTCHours(0, 0, 0, 0);
    const { minBroadcastBalanceUzs: minForOrders, lowBalanceUzs: low } =
      await this.resolveCommissionWalletThresholds();
    const drv = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { balanceUzs: true },
    });
    const zero = new Prisma.Decimal(0);
    const platformCommissionBps = await this.resolveCommissionBps();
    if (!drv) {
      return {
        balanceUzs: "0",
        commissionWalletBalanceUzs: "0",
        minRequiredUzs: String(minForOrders),
        lowBalanceThresholdUzs: String(low),
        walletStatus: "blocked",
        estimatedTripsLeft: 0,
        tripsCompletedWindow: 0,
        windowDays: w,
        tripEarningsNetUzs: "0",
        tripGrossUzs: "0",
        topUpUzs: "0",
        commissionDebitedUzs: "0",
        debtUzs: "0",
        bonusUzs: "0",
        payoutOutUzs: "0",
        adjustmentNetUzs: "0",
        platformCommissionBps,
      };
    }
    const grouped = await this.prisma.earningsLedger.groupBy({
      by: ["type"],
      where: { driverId, createdAt: { gte: from } },
      _sum: { amountUzs: true },
    });
    const sum = (t: EarningsLedgerType) =>
      grouped.find((g) => g.type === t)?._sum.amountUzs ?? zero;
    const wallet = Number(drv.balanceUzs);
    const status =
      wallet < minForOrders ? "blocked" : wallet < low ? "low" : "ok";
    const tripsCompletedWindow = await this.prisma.trip.count({
      where: {
        driverId,
        status: TripStatus.COMPLETED,
        endedAt: { gte: from },
      },
    });
    const tripAgg = await this.prisma.trip.aggregate({
      where: {
        driverId,
        status: TripStatus.COMPLETED,
        endedAt: { gte: from },
        commissionUzs: { gt: 0 },
      },
      _avg: { commissionUzs: true },
    });
    let avgCommission = Number(tripAgg._avg.commissionUzs ?? 0);
    if (!Number.isFinite(avgCommission) || avgCommission <= 0) {
      const debitSum = Number(sum(EarningsLedgerType.TRIP_COMMISSION_DEBIT));
      const debitCnt = await this.prisma.earningsLedger.count({
        where: {
          driverId,
          type: EarningsLedgerType.TRIP_COMMISSION_DEBIT,
          createdAt: { gte: from },
        },
      });
      const ledgerAvg = debitCnt > 0 ? debitSum / debitCnt : 0;
      avgCommission =
        Number.isFinite(ledgerAvg) && ledgerAvg > 0 ? ledgerAvg : 0;
    }
    if (!Number.isFinite(avgCommission) || avgCommission <= 0) {
      avgCommission = Math.max(
        1,
        Math.round(minForOrders * (platformCommissionBps / 10000)),
      );
    }
    const estimatedTripsLeft =
      wallet > 0 ? Math.floor(wallet / Math.max(1, avgCommission)) : 0;
    return {
      balanceUzs: drv.balanceUzs.toString(),
      commissionWalletBalanceUzs: drv.balanceUzs.toString(),
      minRequiredUzs: String(minForOrders),
      lowBalanceThresholdUzs: String(low),
      walletStatus: status,
      estimatedTripsLeft,
      tripsCompletedWindow,
      windowDays: w,
      tripEarningsNetUzs: sum(EarningsLedgerType.TRIP_EARNINGS).toString(),
      tripGrossUzs: sum(EarningsLedgerType.TRIP_EARNINGS).toString(),
      topUpUzs: sum(EarningsLedgerType.TOP_UP).toString(),
      commissionDebitedUzs: sum(
        EarningsLedgerType.TRIP_COMMISSION_DEBIT,
      ).toString(),
      debtUzs: wallet < 0 ? String(Math.abs(wallet)) : "0",
      bonusUzs: sum(EarningsLedgerType.BONUS).toString(),
      payoutOutUzs: sum(EarningsLedgerType.PAYOUT).toString(),
      adjustmentNetUzs: sum(EarningsLedgerType.ADJUSTMENT)
        .add(sum(EarningsLedgerType.MANUAL_ADJUSTMENT_PLUS))
        .sub(sum(EarningsLedgerType.MANUAL_ADJUSTMENT_MINUS))
        .toString(),
      platformCommissionBps,
    };
  }
}
