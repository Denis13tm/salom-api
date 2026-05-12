import { ConfigService } from "@nestjs/config";
import { EarningsLedgerType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "./ledger.service";

/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest expect.objectContaining with Prisma decimals */
describe("LedgerService", () => {
  it("splits 10% platform commission from 10_000 UZS", () => {
    const s = new LedgerService(
      {
        get: (k: string, def: number) =>
          k === "PLATFORM_COMMISSION_BPS" ? 1000 : def,
      } as unknown as ConfigService,
      {} as PrismaService,
    );
    const r = s.splitGrossUzsInt(10_000);
    expect(r.rateBps).toBe(1000);
    expect(Number(r.commission)).toBe(1000);
    expect(Number(r.net)).toBe(9000);
  });

  it("writes a top-up ledger row and updates cached balance in one transaction scope", async () => {
    const s = new LedgerService(
      { get: (_k: string, def: number) => def } as unknown as ConfigService,
      {} as PrismaService,
    );
    const tx = {
      driver: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ balanceUzs: new Prisma.Decimal(5_000) }),
        update: jest.fn().mockResolvedValue({}),
      },
      earningsLedger: {
        create: jest.fn().mockResolvedValue({ id: "ledger-1" }),
      },
    };

    const out = await s.recordTopUp(tx as never, {
      driverId: "driver-1",
      amountUzs: 7_000,
      note: "cash receipt #1",
    });

    expect(out.newBalance.toString()).toBe("12000");
    expect(tx.driver.update).toHaveBeenCalledWith({
      where: { id: "driver-1" },
      data: { balanceUzs: new Prisma.Decimal(12_000) },
    });
    expect(tx.earningsLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        driverId: "driver-1",
        type: EarningsLedgerType.TOP_UP,
        amountUzs: new Prisma.Decimal(7_000),
        balanceAfterUzs: new Prisma.Decimal(12_000),
      }),
    });
  });

  it("normalizes manual negative adjustments to MANUAL_ADJUSTMENT_MINUS with positive ledger amount", async () => {
    const s = new LedgerService(
      { get: (_k: string, def: number) => def } as unknown as ConfigService,
      {} as PrismaService,
    );
    const tx = {
      driver: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ balanceUzs: new Prisma.Decimal(20_000) }),
        update: jest.fn().mockResolvedValue({}),
      },
      earningsLedger: {
        create: jest.fn().mockResolvedValue({ id: "ledger-2" }),
      },
    };

    const out = await s.recordManualAdjustment(tx as never, {
      driverId: "driver-1",
      amountUzs: -4_000,
      note: "penalty",
    });

    expect(out.type).toBe(EarningsLedgerType.MANUAL_ADJUSTMENT_MINUS);
    expect(out.newBalance.toString()).toBe("16000");
    expect(tx.earningsLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: EarningsLedgerType.MANUAL_ADJUSTMENT_MINUS,
        amountUzs: new Prisma.Decimal(4_000),
        balanceAfterUzs: new Prisma.Decimal(16_000),
      }),
    });
  });
});
