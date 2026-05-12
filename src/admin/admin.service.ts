import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DriverOnboardingStatus,
  DriverOperationalStatus,
  DriverMonthSettlementStatus,
  EarningsLedgerType,
  OrderStatus,
  Prisma,
  SmsDeliveryStatus,
  TripStatus,
  UserAccountStatus,
  UserRole,
} from "@prisma/client";
import { randomInt, randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import { createReadStream } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import type { ReadStream } from "node:fs";
import * as path from "node:path";
import { SmsService } from "../notifications/sms.service";
import { PushService } from "../notifications/push.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import type { DriverNoticeCategory } from "../driver-ws/driver-notice-payload";
import { DriverGateway } from "../driver-ws/driver.gateway";
import { normalizePhoneUz } from "../driver-onboarding/phone.util";
import type { PatchPlatformChampionsDto } from "./dto/patch-platform-champions.dto";
import type { PatchPlatformPricingDto } from "./dto/patch-platform-pricing.dto";
import {
  DriverBroadcastAudience,
  SendDriverBroadcastDto,
} from "./dto/send-driver-broadcast.dto";
import type { UpdateAdminDriverNewsDto } from "./dto/update-admin-driver-news.dto";
import type { PatchZonePickupPricingDto } from "./dto/patch-zone-pickup-pricing.dto";
import type { CreatePickupPricingRingDto } from "./dto/create-pricing-ring.dto";
import type { UpdatePickupPricingRingDto } from "./dto/update-pricing-ring.dto";
import { PricingEngineService } from "../orders/pricing-engine.service";
import { GamificationService } from "../gamification/gamification.service";
import type { PatchDriverXpSettingsDto } from "./dto/patch-driver-xp-settings.dto";
import type { Express } from "express";
import {
  CHAMPIONS_BANNER_FILE_RE,
  championsBannerUploadDir,
  parseBannerPathsJson,
} from "../gamification/champions-banners.util";

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly ledger: LedgerService,
    private readonly driverWs: DriverGateway,
    private readonly push: PushService,
    private readonly pricingEngine: PricingEngineService,
    private readonly gamification: GamificationService,
  ) {}

  async platformPricing() {
    const envBps = this.config.get<number>("PLATFORM_COMMISSION_BPS", 1000);
    const row = await this.prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: { platformCommissionBps: true },
    });
    const platformCommissionBps = Math.max(
      0,
      Math.min(10_000, row?.platformCommissionBps ?? envBps),
    );
    const wallet = await this.ledger.resolveCommissionWalletThresholds();
    return {
      meterBaseUzs: this.config.get<number>("METER_BASE_FARE_UZS", 5000),
      meterPerKmUzs: this.config.get<number>("METER_PER_KM_UZS", 5000),
      meterMinSegmentM: this.config.get<number>("METER_MIN_SEGMENT_M", 12),
      platformCommissionBps,
      commissionWalletMinDispatchBalanceUzs: wallet.minBroadcastBalanceUzs,
      commissionWalletLowBalanceUzs: wallet.lowBalanceUzs,
      ledgerRoundingNote:
        "Bruto butun UZS, komissiya: floor(gross * bps / 10_000), net = bruto - komissiya. ADJUSTMENT ixtiyoriy tuzatish.",
    };
  }

  async patchPlatformPricing(
    body: PatchPlatformPricingDto,
    actorUserId?: string,
  ) {
    const existing = await this.prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: {
        platformCommissionBps: true,
        commissionWalletMinBroadcastBalanceUzs: true,
        commissionWalletLowBalanceUzs: true,
      },
    });
    const envBps = this.config.get<number>("PLATFORM_COMMISSION_BPS", 1000);
    const envMin = this.config.get<number>(
      "COMMISSION_WALLET_MIN_BROADCAST_BALANCE_UZS",
      10_000,
    );
    const envLow = this.config.get<number>(
      "COMMISSION_WALLET_LOW_BALANCE_UZS",
      30_000,
    );

    let nextBps = Math.max(
      0,
      Math.min(10_000, existing?.platformCommissionBps ?? envBps),
    );
    if (body.platformCommissionBps !== undefined) {
      nextBps = Math.max(
        0,
        Math.min(10_000, Math.trunc(body.platformCommissionBps)),
      );
    }
    let nextMin = existing?.commissionWalletMinBroadcastBalanceUzs ?? envMin;
    let nextLow = existing?.commissionWalletLowBalanceUzs ?? envLow;
    if (body.commissionWalletMinBroadcastBalanceUzs !== undefined) {
      nextMin = Math.max(
        0,
        Math.min(
          50_000_000,
          Math.trunc(body.commissionWalletMinBroadcastBalanceUzs),
        ),
      );
    }
    if (body.commissionWalletLowBalanceUzs !== undefined) {
      nextLow = Math.max(
        0,
        Math.min(50_000_000, Math.trunc(body.commissionWalletLowBalanceUzs)),
      );
    }
    if (nextLow < nextMin) {
      throw new BadRequestException(
        "commissionWalletLowBalanceUzs minimal komissiya talabidan past bo‘lishi mumkin emas",
      );
    }

    const touched =
      body.platformCommissionBps !== undefined ||
      body.commissionWalletMinBroadcastBalanceUzs !== undefined ||
      body.commissionWalletLowBalanceUzs !== undefined;
    if (!touched) {
      return this.platformPricing();
    }

    await this.prisma.platformSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        platformCommissionBps: nextBps,
        commissionWalletMinBroadcastBalanceUzs: nextMin,
        commissionWalletLowBalanceUzs: nextLow,
      },
      update: {
        platformCommissionBps: nextBps,
        commissionWalletMinBroadcastBalanceUzs: nextMin,
        commissionWalletLowBalanceUzs: nextLow,
      },
    });
    await this.writeAudit(
      actorUserId,
      "platform.pricing_patch",
      "PlatformSettings",
      null,
      {
        platformCommissionBps: nextBps,
        commissionWalletMinBroadcastBalanceUzs: nextMin,
        commissionWalletLowBalanceUzs: nextLow,
        settingsRowId: "default",
      },
    );
    return this.platformPricing();
  }

  async platformChampionsConfig() {
    const row = await this.prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: {
        championsSeasonTitleUz: true,
        championsPrizeDescriptionUz: true,
        championsCadenceHintUz: true,
        championsPrizeUsd: true,
        championsPeriodEndTemplateUz: true,
        championsHomeBannerPathsJson: true,
        championsHomeCarouselIntervalSec: true,
      },
    });
    return {
      championsSeasonTitleUz: row?.championsSeasonTitleUz ?? null,
      championsPrizeDescriptionUz: row?.championsPrizeDescriptionUz ?? null,
      championsCadenceHintUz: row?.championsCadenceHintUz ?? null,
      championsPrizeUsd: row?.championsPrizeUsd ?? 100,
      championsPeriodEndTemplateUz: row?.championsPeriodEndTemplateUz ?? null,
      championsHomeBannerPaths: parseBannerPathsJson(row?.championsHomeBannerPathsJson),
      championsHomeCarouselIntervalSec: row?.championsHomeCarouselIntervalSec ?? 5,
      /** Qo‘llanma */
      templateHint:
        "Sana uchun `{{DATE}}` yoki `{date}` placeholders — chorak oxiri (YYYY-MM-DD) bilan almashtiriladi.",
    };
  }

  async patchPlatformChampions(
    body: PatchPlatformChampionsDto,
    actorUserId?: string,
  ) {
    const existing = await this.prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: {
        platformCommissionBps: true,
        commissionWalletMinBroadcastBalanceUzs: true,
        commissionWalletLowBalanceUzs: true,
        championsHomeBannerPathsJson: true,
      },
    });
    const envBps = this.config.get<number>("PLATFORM_COMMISSION_BPS", 1000);
    const envMin = this.config.get<number>(
      "COMMISSION_WALLET_MIN_BROADCAST_BALANCE_UZS",
      10_000,
    );
    const envLow = this.config.get<number>(
      "COMMISSION_WALLET_LOW_BALANCE_UZS",
      30_000,
    );

    const touched =
      body.championsSeasonTitleUz !== undefined ||
      body.championsPrizeDescriptionUz !== undefined ||
      body.championsCadenceHintUz !== undefined ||
      body.championsPrizeUsd !== undefined ||
      body.championsPeriodEndTemplateUz !== undefined ||
      body.championsHomeBannerPaths !== undefined ||
      body.championsHomeCarouselIntervalSec !== undefined;
    if (!touched) {
      return this.platformChampionsConfig();
    }

    const trimOrNull = (s: string | undefined) => {
      if (s === undefined) return undefined;
      const t = s.trim();
      return t.length === 0 ? null : t;
    };

    const prevPaths = parseBannerPathsJson(existing?.championsHomeBannerPathsJson);
    let nextNormalizedPaths: string[] | undefined;
    if (body.championsHomeBannerPaths !== undefined) {
      nextNormalizedPaths = this.normalizeChampionsHomeBannerPaths(body.championsHomeBannerPaths);
      for (const p of prevPaths) {
        if (!nextNormalizedPaths.includes(p)) {
          void this.unlinkChampionBannerFile(p).catch(() => undefined);
        }
      }
    }

    const intervalPatch =
      body.championsHomeCarouselIntervalSec !== undefined
        ? Math.min(60, Math.max(3, Math.trunc(body.championsHomeCarouselIntervalSec)))
        : undefined;

    await this.prisma.platformSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        platformCommissionBps: Math.max(
          0,
          Math.min(10_000, existing?.platformCommissionBps ?? envBps),
        ),
        commissionWalletMinBroadcastBalanceUzs:
          existing?.commissionWalletMinBroadcastBalanceUzs ?? envMin,
        commissionWalletLowBalanceUzs:
          existing?.commissionWalletLowBalanceUzs ?? envLow,
        championsSeasonTitleUz: trimOrNull(body.championsSeasonTitleUz) ?? null,
        championsPrizeDescriptionUz:
          trimOrNull(body.championsPrizeDescriptionUz) ?? null,
        championsCadenceHintUz: trimOrNull(body.championsCadenceHintUz) ?? null,
        championsPrizeUsd: body.championsPrizeUsd ?? 100,
        championsPeriodEndTemplateUz:
          trimOrNull(body.championsPeriodEndTemplateUz) ?? null,
        championsHomeCarouselIntervalSec: intervalPatch ?? 5,
        ...(nextNormalizedPaths !== undefined
          ? { championsHomeBannerPathsJson: nextNormalizedPaths }
          : {}),
      },
      update: {
        ...(body.championsSeasonTitleUz !== undefined && {
          championsSeasonTitleUz:
            trimOrNull(body.championsSeasonTitleUz) ?? null,
        }),
        ...(body.championsPrizeDescriptionUz !== undefined && {
          championsPrizeDescriptionUz:
            trimOrNull(body.championsPrizeDescriptionUz) ?? null,
        }),
        ...(body.championsCadenceHintUz !== undefined && {
          championsCadenceHintUz:
            trimOrNull(body.championsCadenceHintUz) ?? null,
        }),
        ...(body.championsPrizeUsd !== undefined && {
          championsPrizeUsd: Math.max(
            0,
            Math.min(1_000_000, Math.trunc(body.championsPrizeUsd)),
          ),
        }),
        ...(body.championsPeriodEndTemplateUz !== undefined && {
          championsPeriodEndTemplateUz:
            trimOrNull(body.championsPeriodEndTemplateUz) ?? null,
        }),
        ...(nextNormalizedPaths !== undefined && {
          championsHomeBannerPathsJson: nextNormalizedPaths,
        }),
        ...(intervalPatch !== undefined && {
          championsHomeCarouselIntervalSec: intervalPatch,
        }),
      },
    });
    await this.writeAudit(
      actorUserId,
      "platform.champions_patch",
      "PlatformSettings",
      null,
      {
        patch: body,
        settingsRowId: "default",
      },
    );
    return this.platformChampionsConfig();
  }

  private normalizeChampionsHomeBannerPaths(raw: string[]): string[] {
    const out: string[] = [];
    for (const x of raw) {
      const t = (x ?? "").trim();
      if (!CHAMPIONS_BANNER_FILE_RE.test(t)) {
        throw new BadRequestException(`Noto‘g‘ri banner fayl nomi: ${String(x)}`);
      }
      out.push(t);
    }
    if (out.length > 12) {
      throw new BadRequestException("Eng ko‘pi bilan 12 ta banner");
    }
    return out;
  }

  private async unlinkChampionBannerFile(filename: string): Promise<void> {
    if (!CHAMPIONS_BANNER_FILE_RE.test(filename)) return;
    const full = path.join(championsBannerUploadDir(), filename);
    try {
      await unlink(full);
    } catch {
      /* ignore */
    }
  }

  async uploadChampionsHomeBannerFile(
    file: Express.Multer.File | undefined,
    actorUserId?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("file maydoni majburiy");
    }
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
      throw new BadRequestException("Faqat png, jpg, jpeg, webp");
    }
    const name = `${randomUUID()}${ext}`;
    const dir = championsBannerUploadDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), file.buffer);

    const row = await this.prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: { championsHomeBannerPathsJson: true },
    });
    const cur = parseBannerPathsJson(row?.championsHomeBannerPathsJson);
    if (cur.length >= 12) {
      throw new BadRequestException("Eng ko‘pi bilan 12 ta banner");
    }
    const next = [...cur, name];

    await this.prisma.platformSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        platformCommissionBps: this.config.get<number>("PLATFORM_COMMISSION_BPS", 1000),
        commissionWalletMinBroadcastBalanceUzs: this.config.get<number>(
          "COMMISSION_WALLET_MIN_BROADCAST_BALANCE_UZS",
          10_000,
        ),
        commissionWalletLowBalanceUzs: this.config.get<number>(
          "COMMISSION_WALLET_LOW_BALANCE_UZS",
          30_000,
        ),
        championsHomeBannerPathsJson: next,
      },
      update: { championsHomeBannerPathsJson: next },
    });
    await this.writeAudit(
      actorUserId,
      "platform.champions_banner_upload",
      "PlatformSettings",
      null,
      {
        filename: name,
      },
    );
    return {
      filename: name,
      url: `/api/v1/public/champions-banners/${name}`,
      paths: next,
    };
  }

  async deleteChampionsHomeBannerFile(filename: string, actorUserId?: string) {
    const base = path.basename(filename || "");
    if (!CHAMPIONS_BANNER_FILE_RE.test(base)) {
      throw new BadRequestException("Noto‘g‘ri fayl nomi");
    }
    const row = await this.prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: { championsHomeBannerPathsJson: true },
    });
    const cur = parseBannerPathsJson(row?.championsHomeBannerPathsJson);
    if (!cur.includes(base)) {
      throw new NotFoundException("Banner ro‘yxatda yo‘q");
    }
    const next = cur.filter((x) => x !== base);
    await this.prisma.platformSettings.update({
      where: { id: "default" },
      data: { championsHomeBannerPathsJson: next },
    });
    await this.unlinkChampionBannerFile(base);
    await this.writeAudit(
      actorUserId,
      "platform.champions_banner_delete",
      "PlatformSettings",
      null,
      {
        filename: base,
      },
    );
    return this.platformChampionsConfig();
  }

  securityInfo() {
    return {
      allowLegacyAuthHeaders:
        this.config.get<string>("ALLOW_LEGACY_AUTH_HEADERS", "false") ===
        "true",
      exchangeSecretConfigured: Boolean(
        (this.config.get<string>("SALOM_EXCHANGE_SECRET") ?? "").trim().length,
      ),
      smsMode: (
        this.config.get<string>("SMS_MODE", "log") || "log"
      ).toLowerCase(),
      otpLoginEnabled:
        this.config.get<string>("OTP_LOGIN_ENABLED", "false") === "true",
      driverRegistrationOtp:
        this.config.get<string>("DRIVER_REGISTRATION_OTP", "true") === "true",
    };
  }

  async dashboard() {
    const now = new Date();
    const dayStart = startOfUtcDay(now);
    const cancelStatuses: OrderStatus[] = [
      OrderStatus.CANCELLED_BY_OPERATOR,
      OrderStatus.CANCELLED_BY_DRIVER,
      OrderStatus.CANCELLED_BY_PASSENGER,
      OrderStatus.EXPIRED,
    ];

    const [
      ordersToday,
      completedToday,
      cancelledToday,
      activeDrivers,
      onlineDrivers,
      disputedTrips,
      gmvRow,
      commissionRow,
      balanceSum,
    ] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: dayStart } } }),
      this.prisma.order.count({
        where: { status: OrderStatus.COMPLETED, updatedAt: { gte: dayStart } },
      }),
      this.prisma.order.count({
        where: { status: { in: cancelStatuses }, updatedAt: { gte: dayStart } },
      }),
      this.prisma.driver.count({
        where: {
          operationalStatus: { not: DriverOperationalStatus.OFFLINE },
        },
      }),
      this.prisma.driver.count({
        where: {
          operationalStatus: {
            in: [
              DriverOperationalStatus.ONLINE_IDLE,
              DriverOperationalStatus.ORDER_OFFERED,
              DriverOperationalStatus.EN_ROUTE_PICKUP,
              DriverOperationalStatus.ARRIVED_PICKUP,
              DriverOperationalStatus.IN_TRIP,
            ],
          },
        },
      }),
      this.prisma.trip.count({ where: { status: TripStatus.DISPUTED } }),
      this.prisma.trip.aggregate({
        where: {
          status: TripStatus.COMPLETED,
          endedAt: { gte: dayStart },
          grossUzs: { not: null },
        },
        _sum: { grossUzs: true },
      }),
      this.prisma.commissionLedger.aggregate({
        where: { createdAt: { gte: dayStart } },
        _sum: { amountUzs: true },
      }),
      this.prisma.driver.aggregate({ _sum: { balanceUzs: true } }),
    ]);

    const gmvUzs = gmvRow._sum.grossUzs ? Number(gmvRow._sum.grossUzs) : 0;
    const commissionUzs = commissionRow._sum.amountUzs
      ? Number(commissionRow._sum.amountUzs)
      : 0;
    const totalBalanceUzs = balanceSum._sum.balanceUzs
      ? Number(balanceSum._sum.balanceUzs)
      : 0;
    const finished = completedToday + cancelledToday;
    const cancelRate = finished > 0 ? cancelledToday / finished : 0;

    return {
      generatedAt: now.toISOString(),
      dayStartUtc: dayStart.toISOString(),
      ordersToday,
      completedToday,
      cancelledToday,
      cancelRate: Math.round(cancelRate * 1000) / 1000,
      activeDrivers,
      onlineDrivers,
      openDisputes: disputedTrips,
      gmvUzs,
      commissionUzs,
      totalDriverBalanceUzs: totalBalanceUzs,
      pricing: await this.platformPricing(),
    };
  }

  async listDrivers(params: {
    take: number;
    skip: number;
    q?: string;
    zoneId?: string;
    accountStatus?: UserAccountStatus;
    onboardingStatus?: DriverOnboardingStatus;
  }) {
    const andParts: Prisma.DriverWhereInput[] = [];
    if (params.zoneId?.trim()) {
      andParts.push({ serviceZoneId: params.zoneId.trim() });
    }
    if (params.accountStatus) {
      andParts.push({ user: { status: params.accountStatus } });
    }
    if (params.onboardingStatus) {
      andParts.push({ onboardingStatus: params.onboardingStatus });
    }
    if (params.q?.trim()) {
      const q = params.q.trim();
      andParts.push({
        OR: [
          { user: { phone: { contains: q, mode: "insensitive" } } },
          {
            vehicles: { some: { plate: { contains: q, mode: "insensitive" } } },
          },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { passportOrId: { contains: q, mode: "insensitive" } },
          { passportSeries: { contains: q, mode: "insensitive" } },
          { passportNumber: { contains: q, mode: "insensitive" } },
          { serviceZone: { name: { contains: q, mode: "insensitive" } } },
          { serviceZone: { slug: { contains: q, mode: "insensitive" } } },
        ],
      });
    }
    const where: Prisma.DriverWhereInput =
      andParts.length > 0 ? { AND: andParts } : {};
    const [rows, total] = await Promise.all([
      this.prisma.driver.findMany({
        where,
        take: params.take,
        skip: params.skip,
        orderBy: { updatedAt: "desc" },
        include: {
          user: { select: { phone: true, status: true } },
          serviceZone: { select: { id: true, name: true, slug: true } },
          vehicles: { where: { isActive: true }, take: 1 },
        },
      }),
      this.prisma.driver.count({ where }),
    ]);
    return {
      total,
      items: rows.map((d) => ({
        id: d.id,
        phone: d.user.phone,
        firstName: d.firstName,
        lastName: d.lastName,
        accountStatus: d.user.status,
        onboardingStatus: d.onboardingStatus,
        operationalStatus: d.operationalStatus,
        balanceUzs: d.balanceUzs.toString(),
        zone: d.serviceZone,
        primaryVehicle: d.vehicles[0]
          ? { plate: d.vehicles[0].plate, makeModel: d.vehicles[0].makeModel }
          : null,
        updatedAt: d.updatedAt.toISOString(),
      })),
    };
  }

  async createDriverByAdmin(
    body: {
      phone: string;
      firstName?: string;
      lastName?: string;
      serviceZoneId?: string | null;
      balanceUzs?: number;
      activationCode?: string;
      passportSeries?: string;
      passportNumber?: string;
      vehicle?: {
        plate: string;
        plateRegionCode?: string | null;
        makeModel: string;
        year?: number | null;
        color?: string | null;
      };
    },
    actorUserId?: string,
  ) {
    const phone = normalizePhoneUz(body.phone);
    const existing = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, role: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.role === UserRole.DRIVER
          ? "Ushbu raqam bilan haydovchi allaqachon mavjud"
          : "Telefon allaqachon ro‘yxatda",
      );
    }

    const serviceZoneId = body.serviceZoneId?.trim() || null;
    if (serviceZoneId) {
      const zone = await this.prisma.serviceZone.findUnique({
        where: { id: serviceZoneId },
        select: { id: true, isActive: true },
      });
      if (!zone) {
        throw new NotFoundException("Zona topilmadi");
      }
      if (!zone.isActive) {
        throw new BadRequestException(
          "Nofaol zonaga haydovchi biriktirib bo‘lmaydi",
        );
      }
    }

    const providedCode = body.activationCode?.trim();
    const activationCode = providedCode || (await this.nextActivationCode());
    if (!/^\d{12}$/.test(activationCode)) {
      throw new BadRequestException(
        "activationCode 12 ta raqam bo‘lishi kerak",
      );
    }
    const codeOwner = await this.prisma.driver.findUnique({
      where: { activationCode },
      select: { id: true },
    });
    if (codeOwner) {
      throw new ConflictException(
        "Ushbu 12 xonali aktivatsiya kodi allaqachon ishlatilgan",
      );
    }

    const balanceUzs = Math.trunc(body.balanceUzs ?? 0);
    if (!Number.isFinite(balanceUzs) || balanceUzs < 0) {
      throw new BadRequestException(
        "balanceUzs 0 yoki undan katta butun son bo‘lishi kerak",
      );
    }

    const firstName = body.firstName?.trim() || null;
    const lastName = body.lastName?.trim() || null;
    const passportSeries = body.passportSeries?.trim() || null;
    const passportNumber = body.passportNumber?.trim() || null;
    const passportOrIdCombined =
      [passportSeries, passportNumber].filter(Boolean).join(" ").trim() || null;
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone,
          role: UserRole.DRIVER,
          status: UserAccountStatus.ACTIVE,
        },
      });
      const driver = await tx.driver.create({
        data: {
          userId: user.id,
          serviceZoneId,
          firstName,
          lastName,
          passportSeries,
          passportNumber,
          passportOrId: passportOrIdCombined,
          onboardingStatus: DriverOnboardingStatus.APPROVED,
          reviewedAt: new Date(),
          activationCode,
          activationCodeIssuedAt: new Date(),
        },
        include: {
          serviceZone: { select: { id: true, name: true, slug: true } },
        },
      });
      const veh = body.vehicle;
      if (veh?.plate?.trim() && veh.makeModel?.trim()) {
        await tx.vehicle.create({
          data: {
            driverId: driver.id,
            plate: veh.plate.trim(),
            plateRegionCode: veh.plateRegionCode?.trim() || null,
            makeModel: veh.makeModel.trim(),
            year: veh.year ?? null,
            color: veh.color?.trim() ?? null,
            serviceZoneId,
            isActive: true,
          },
        });
      }
      if (balanceUzs <= 0) {
        return {
          user,
          driver,
          balanceAfter: driver.balanceUzs,
          topUpLedgerId: null as string | null,
        };
      }
      const topUp = await this.ledger.recordTopUp(tx, {
        driverId: driver.id,
        amountUzs: balanceUzs,
        note: "Admin initial top-up during driver creation",
      });
      return {
        user,
        driver,
        balanceAfter: topUp.newBalance,
        topUpLedgerId: topUp.ledgerId,
      };
    });

    await this.writeAudit(
      actorUserId,
      "driver.admin_create",
      "Driver",
      created.driver.id,
      {
        phone,
        serviceZoneId,
        balanceUzs,
        activationCode,
        ...(created.topUpLedgerId
          ? { topUpLedgerId: created.topUpLedgerId }
          : {}),
      },
    );

    return {
      ok: true as const,
      driverId: created.driver.id,
      userId: created.user.id,
      phone,
      firstName: created.driver.firstName,
      lastName: created.driver.lastName,
      accountStatus: created.user.status,
      onboardingStatus: created.driver.onboardingStatus,
      activationCode,
      balanceUzs: created.balanceAfter.toString(),
      zone: created.driver.serviceZone,
    };
  }

  private async nextActivationCode(): Promise<string> {
    for (let k = 0; k < 48; k++) {
      const s = Array.from({ length: 12 }, () => String(randomInt(0, 10))).join(
        "",
      );
      const hit = await this.prisma.driver.findUnique({
        where: { activationCode: s },
      });
      if (!hit) {
        return s;
      }
    }
    throw new Error("activation_code");
  }

  async listPendingDrivers() {
    const [rows, total] = await Promise.all([
      this.prisma.driver.findMany({
        where: {
          onboardingStatus: {
            in: [
              DriverOnboardingStatus.SUBMITTED,
              DriverOnboardingStatus.UNDER_REVIEW,
            ],
          },
        },
        take: 200,
        orderBy: { submittedAt: "asc" },
        include: {
          user: { select: { phone: true, status: true } },
          serviceZone: { select: { id: true, name: true, slug: true } },
          vehicles: { where: { isActive: true }, take: 1 },
        },
      }),
      this.prisma.driver.count({
        where: {
          onboardingStatus: {
            in: [
              DriverOnboardingStatus.SUBMITTED,
              DriverOnboardingStatus.UNDER_REVIEW,
            ],
          },
        },
      }),
    ]);
    return {
      total,
      items: rows.map((d) => ({
        id: d.id,
        phone: d.user.phone,
        accountStatus: d.user.status,
        onboardingStatus: d.onboardingStatus,
        submittedAt: d.submittedAt?.toISOString() ?? null,
        operationalStatus: d.operationalStatus,
        balanceUzs: d.balanceUzs.toString(),
        zone: d.serviceZone,
        primaryVehicle: d.vehicles[0]
          ? { plate: d.vehicles[0].plate, makeModel: d.vehicles[0].makeModel }
          : null,
        updatedAt: d.updatedAt.toISOString(),
      })),
    };
  }

  /** Operator web: faqat bitta xizmat zonasidagi kutilayotgan arizalar. */
  async listPendingDriversInServiceZone(serviceZoneId: string) {
    const [rows, total] = await Promise.all([
      this.prisma.driver.findMany({
        where: {
          serviceZoneId,
          onboardingStatus: {
            in: [
              DriverOnboardingStatus.SUBMITTED,
              DriverOnboardingStatus.UNDER_REVIEW,
            ],
          },
        },
        take: 200,
        orderBy: { submittedAt: "asc" },
        include: {
          user: { select: { phone: true, status: true } },
          serviceZone: { select: { id: true, name: true, slug: true } },
          vehicles: { where: { isActive: true }, take: 1 },
        },
      }),
      this.prisma.driver.count({
        where: {
          serviceZoneId,
          onboardingStatus: {
            in: [
              DriverOnboardingStatus.SUBMITTED,
              DriverOnboardingStatus.UNDER_REVIEW,
            ],
          },
        },
      }),
    ]);
    return {
      total,
      serviceZoneId,
      items: rows.map((d) => ({
        id: d.id,
        phone: d.user.phone,
        accountStatus: d.user.status,
        onboardingStatus: d.onboardingStatus,
        submittedAt: d.submittedAt?.toISOString() ?? null,
        operationalStatus: d.operationalStatus,
        balanceUzs: d.balanceUzs.toString(),
        zone: d.serviceZone,
        primaryVehicle: d.vehicles[0]
          ? { plate: d.vehicles[0].plate, makeModel: d.vehicles[0].makeModel }
          : null,
        updatedAt: d.updatedAt.toISOString(),
      })),
    };
  }

  async getDriver(id: string) {
    const d = await this.prisma.driver.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            status: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
        serviceZone: true,
        vehicles: { orderBy: { createdAt: "desc" } },
        documents: { orderBy: { createdAt: "desc" } },
        subscriptions: {
          take: 5,
          orderBy: { endAt: "desc" },
          include: {
            package: true,
            serviceZone: { select: { name: true, id: true } },
          },
        },
      },
    });
    if (!d) {
      throw new NotFoundException("Driver not found");
    }
    const [
      ordersN,
      tripsN,
      lastTrips,
      ledgerTail,
      financeSummary,
      reconciliation,
    ] = await Promise.all([
      this.prisma.order.count({ where: { assignedDriverId: id } }),
      this.prisma.trip.count({ where: { driverId: id } }),
      this.prisma.trip.findMany({
        where: { driverId: id },
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              customerPhone: true,
              pickupLandmark: true,
            },
          },
        },
      }),
      this.prisma.earningsLedger.findMany({
        where: { driverId: id },
        take: 20,
        orderBy: { createdAt: "desc" },
        include: {
          order: { select: { id: true, pickupLandmark: true } },
          trip: { select: { id: true, status: true } },
        },
      }),
      this.ledger.getDriverFinanceSummary(id, 30),
      this.ledger.reconcileDriverBalance(id),
    ]);
    return {
      id: d.id,
      userId: d.userId,
      serviceZoneId: d.serviceZoneId,
      operationalStatus: d.operationalStatus,
      balanceUzs: d.balanceUzs.toString(),
      ratingAvg: d.ratingAvg?.toString() ?? null,
      payoutIban: d.payoutIban,
      payoutAccountName: d.payoutAccountName,
      onboardingStatus: d.onboardingStatus,
      firstName: d.firstName,
      lastName: d.lastName,
      passportOrId: d.passportOrId,
      passportSeries: d.passportSeries,
      passportNumber: d.passportNumber,
      referralNote: d.referralNote,
      submittedAt: d.submittedAt,
      reviewedAt: d.reviewedAt,
      rejectionReason: d.rejectionReason,
      activationCode: d.activationCode,
      activationCodeIssuedAt: d.activationCodeIssuedAt,
      appActivatedAt: d.appActivatedAt,
      needsAppActivation: Boolean(d.activationCode && !d.appActivatedAt),
      adminNotes: d.adminNotes,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      user: d.user,
      serviceZone: d.serviceZone,
      vehicles: d.vehicles.map((v) => ({
        id: v.id,
        plate: v.plate,
        plateRegionCode: v.plateRegionCode,
        makeModel: v.makeModel,
        year: v.year,
        color: v.color,
        isActive: v.isActive,
        createdAt: v.createdAt,
      })),
      documents: d.documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        status: doc.status,
        validUntil: doc.validUntil,
        createdAt: doc.createdAt,
      })),
      subscriptions: d.subscriptions.map((s) => ({
        id: s.id,
        status: s.status,
        startAt: s.startAt,
        endAt: s.endAt,
        package: {
          id: s.package.id,
          name: s.package.name,
          priceUzs: s.package.priceUzs.toString(),
          priorityWeight: s.package.priorityWeight.toString(),
        },
        zone: s.serviceZone,
      })),
      stats: { ordersTotal: ordersN, tripsTotal: tripsN },
      recentTrips: lastTrips.map((t) => ({
        id: t.id,
        status: t.status,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        grossUzs: t.grossUzs?.toString() ?? null,
        commissionUzs: t.commissionUzs?.toString() ?? null,
        netUzs: t.netUzs?.toString() ?? null,
        finalFareUzs: t.finalFareUzs?.toString() ?? null,
        order: t.order,
      })),
      recentEarnings: ledgerTail.map((e) => ({
        id: e.id,
        type: e.type,
        amountUzs: e.amountUzs.toString(),
        balanceAfterUzs: e.balanceAfterUzs?.toString() ?? null,
        createdAt: e.createdAt,
        note: e.note,
        order: e.order,
        trip: e.trip,
      })),
      financeSummary,
      balanceReconciliation: reconciliation,
    };
  }

  /**
   * Operator panel: kundalik ish — moliya, ledger, hujjatlar va toʻliq boshqa tafsilotlar yo‘q (faqat Admin).
   */
  async getDriverProfileForOperator(id: string) {
    const d = await this.prisma.driver.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            status: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
        serviceZone: true,
        vehicles: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!d) {
      throw new NotFoundException("Driver not found");
    }
    const [ordersN, tripsN, lastTrips] = await Promise.all([
      this.prisma.order.count({ where: { assignedDriverId: id } }),
      this.prisma.trip.count({ where: { driverId: id } }),
      this.prisma.trip.findMany({
        where: { driverId: id },
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          startedAt: true,
          endedAt: true,
          order: { select: { pickupLandmark: true, customerPhone: true } },
        },
      }),
    ]);
    return {
      id: d.id,
      serviceZoneId: d.serviceZoneId,
      operationalStatus: d.operationalStatus,
      onboardingStatus: d.onboardingStatus,
      firstName: d.firstName,
      lastName: d.lastName,
      passportOrId: d.passportOrId,
      referralNote: d.referralNote,
      adminNotes: d.adminNotes,
      user: d.user,
      serviceZone: d.serviceZone,
      vehicles: d.vehicles.map((v) => ({
        id: v.id,
        plate: v.plate,
        plateRegionCode: v.plateRegionCode,
        makeModel: v.makeModel,
        year: v.year,
        color: v.color,
        isActive: v.isActive,
        createdAt: v.createdAt,
      })),
      stats: { ordersTotal: ordersN, tripsTotal: tripsN },
      recentTrips: lastTrips.map((t) => ({
        id: t.id,
        status: t.status,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        order: t.order,
      })),
    };
  }

  /**
   * Haydovchi yuklagan hujjat faylini diskdan oqish — admin/operator preview.
   */
  async openDriverDocumentStream(
    driverId: string,
    documentId: string,
  ): Promise<{ stream: ReadStream; mimeType: string }> {
    const doc = await this.prisma.driverDocument.findFirst({
      where: { id: documentId, driverId },
      select: { storageKey: true },
    });
    if (!doc) {
      throw new NotFoundException("Document not found");
    }
    const root = path.resolve(
      process.env.DRIVER_DOC_UPLOAD_DIR ||
        path.join(process.cwd(), "var", "driver-uploads"),
    );
    const rel = doc.storageKey.replace(/^[\\/]+/, "");
    const full = path.resolve(path.join(root, rel));
    const relative = path.relative(root, full);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ForbiddenException("Invalid storage path");
    }
    try {
      await access(full);
    } catch {
      throw new NotFoundException(
        "Fayl serverda topilmadi (migratsiya yoki disk)",
      );
    }
    const ext = path.extname(full).toLowerCase();
    const mimeType =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : ext === ".heic" || ext === ".heif"
              ? "image/heic"
              : "image/jpeg";
    return { stream: createReadStream(full), mimeType };
  }

  private async writeAudit(
    actorUserId: string | undefined,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        actorId: actorUserId,
        metadata:
          metadata != null ? (metadata as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  private emitDriverRealtimeNotice(
    driverId: string,
    category: DriverNoticeCategory,
    title: string,
    body: string,
  ) {
    this.driverWs.emitDriverNotice(driverId, {
      v: 1,
      id: randomUUID(),
      category,
      title,
      body,
      occurredAt: new Date().toISOString(),
    });
  }

  async approveDriver(
    driverId: string,
    actorUserId?: string,
    audit?: { operatorId?: string },
  ) {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: { select: { id: true, status: true, phone: true } } },
    });
    if (!d) {
      throw new NotFoundException("Driver not found");
    }
    if (
      d.onboardingStatus !== DriverOnboardingStatus.SUBMITTED &&
      d.onboardingStatus !== DriverOnboardingStatus.UNDER_REVIEW
    ) {
      if (d.onboardingStatus === DriverOnboardingStatus.APPROVED) {
        if (d.user.status === UserAccountStatus.SUSPENDED) {
          const code = await this.nextActivationCode();
          await this.prisma.$transaction([
            this.prisma.user.update({
              where: { id: d.userId },
              data: { status: UserAccountStatus.ACTIVE },
            }),
            this.prisma.driver.update({
              where: { id: driverId },
              data: {
                activationCode: code,
                activationCodeIssuedAt: new Date(),
              },
            }),
          ]);
          const p = d.user.phone.trim();
          const dial = p.match(/^\+/) ? p : `+${p.replace(/\D/g, "")}`;
          const smsBody = `Salom Taxi: hisob qayta faollashtirildi. 12 xonali kodingiz: ${code}. Ilovada kiriting.`;
          try {
            await this.sms.sendToCustomer(null, dial, smsBody);
          } catch {
            // kod API javobida qoladi
          }
          await this.writeAudit(
            actorUserId,
            "driver.reactivate",
            "Driver",
            driverId,
            {
              fromStatus: UserAccountStatus.SUSPENDED,
              toStatus: "ACTIVE",
              activationCode: code,
            },
          );
          this.emitDriverRealtimeNotice(
            driverId,
            "account_restored",
            "Yana chiqish va ishlashingiz mumkin",
            "Hisobingiz qayta yoqildi. Yangi kod boʻlsa, SMS bilan keladi — ilovada davom etishingiz mumkin.",
          );
          return {
            ok: true as const,
            driverId,
            userId: d.userId,
            activationCode: code,
            reactivated: true as const,
          };
        }
        return {
          ok: true as const,
          driverId,
          userId: d.userId,
          alreadyApproved: true as const,
          activationCode: d.activationCode,
        };
      }
      throw new BadRequestException(
        "Faqat yuborilgan arizani (SUBMITTED / UNDER_REVIEW) tasdiqlash mumkin",
      );
    }
    const code = await this.nextActivationCode();
    const fromStatus = d.user.status;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: d.userId },
        data: { status: UserAccountStatus.ACTIVE },
      }),
      this.prisma.driver.update({
        where: { id: driverId },
        data: {
          onboardingStatus: DriverOnboardingStatus.APPROVED,
          activationCode: code,
          activationCodeIssuedAt: new Date(),
          reviewedAt: new Date(),
        },
      }),
    ]);
    const p = d.user.phone.trim();
    const dial = p.match(/^\+/) ? p : `+${p.replace(/\D/g, "")}`;
    const smsBody = `Salom Taxi: sizning 12 xonali haydovchi kodingiz: ${code}. Iloveda "Faollashtirish" ekranida kiriting.`;
    try {
      await this.sms.sendToCustomer(null, dial, smsBody);
    } catch {
      // SMS provayder xato — kod API javobida qoladi
    }
    await this.writeAudit(actorUserId, "driver.approve", "Driver", driverId, {
      fromStatus,
      toStatus: "ACTIVE",
      activationCode: code,
      ...(audit?.operatorId ? { approvedByOperatorId: audit.operatorId } : {}),
    });
    this.emitDriverRealtimeNotice(
      driverId,
      "application_approved",
      "Tabriklaymiz, arizangiz tasdiqlandi",
      "Asosiy tasdiqlash kodingiz yuboriladi. Ilovadagi faollashtirish bo‘limida kodni kiriting va keyin buyurtma olishingiz mumkin.",
    );
    return {
      ok: true as const,
      driverId,
      userId: d.userId,
      activationCode: code,
    };
  }

  async rejectDriver(
    driverId: string,
    reason: string,
    actorUserId?: string,
    audit?: { operatorId?: string },
  ) {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: { select: { id: true, status: true } } },
    });
    if (!d) {
      throw new NotFoundException("Driver not found");
    }
    if (d.onboardingStatus === DriverOnboardingStatus.APPROVED) {
      throw new BadRequestException(
        "Tasdiqlangan haydovchini rad etish: avval to‘xtatish ishlatiladi",
      );
    }
    await this.prisma.driver.update({
      where: { id: driverId },
      data: {
        onboardingStatus: DriverOnboardingStatus.REJECTED,
        rejectionReason: reason.trim(),
        reviewedAt: new Date(),
      },
    });
    await this.writeAudit(actorUserId, "driver.reject", "Driver", driverId, {
      reason: reason.trim(),
      ...(audit?.operatorId ? { rejectedByOperatorId: audit.operatorId } : {}),
    });
    const r = reason.trim();
    const hint = r.length > 200 ? `${r.slice(0, 197)}…` : r;
    this.emitDriverRealtimeNotice(
      driverId,
      "application_rejected",
      "Arizangiz hozircha qabul qilinmadi",
      hint
        ? `Izoh: ${hint}. Keyinroq qayta urinib ko‘rishingiz mumkin.`
        : "Keyinroq qayta urinib ko‘rishingiz mumkin yoki qo‘llab-quvvatlashdan yordam so‘rang.",
    );
    return { ok: true as const, driverId };
  }

  async setDriverUnderReview(
    driverId: string,
    actorUserId?: string,
    audit?: { operatorId?: string },
  ) {
    const d = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!d) {
      throw new NotFoundException("Driver not found");
    }
    if (d.onboardingStatus !== DriverOnboardingStatus.SUBMITTED) {
      throw new BadRequestException(
        "Faqat YUBORILGAN (SUBMITTED) arizani 'ko'rib chiqilmoqda' qilish mumkin",
      );
    }
    await this.prisma.driver.update({
      where: { id: driverId },
      data: {
        onboardingStatus: DriverOnboardingStatus.UNDER_REVIEW,
        reviewedAt: new Date(),
      },
    });
    await this.writeAudit(
      actorUserId,
      "driver.under_review",
      "Driver",
      driverId,
      {
        ...(audit?.operatorId ? { operatorId: audit.operatorId } : {}),
      },
    );
    this.emitDriverRealtimeNotice(
      driverId,
      "application_under_review",
      "Profilingiz tekshirilmoqda",
      "Maʼlumotlaringizni tekshiryapmiz. Natija tez orada shu ilova orqali aniq boʻladi — sahifani yangilab turing.",
    );
    return { ok: true as const, driverId };
  }

  async suspendDriver(driverId: string, actorUserId?: string) {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: { select: { id: true, status: true } } },
    });
    if (!d) {
      throw new NotFoundException("Driver not found");
    }
    const fromStatus = d.user.status;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: d.userId },
        data: { status: UserAccountStatus.SUSPENDED },
      }),
      this.prisma.driver.update({
        where: { id: driverId },
        data: { operationalStatus: DriverOperationalStatus.OFFLINE },
      }),
    ]);
    await this.writeAudit(actorUserId, "driver.suspend", "Driver", driverId, {
      fromStatus,
      toStatus: "SUSPENDED",
    });
    this.emitDriverRealtimeNotice(
      driverId,
      "account_suspended",
      "Hisobingiz vaqtincha toʻxtatildi",
      "Yangi takliflar va ayrim xizmatlar hozir oʻchiq. Savollar boʻlsa yoki bu xatolik boʻlmasa — qo‘llab-quvvatlash bilan bog‘laning.",
    );
    return { ok: true as const, driverId };
  }

  /**
   * User + Driver qatorlari olib tashlanadi (cascade).
   * Tarixdagi safarlar: tegishli Order(lar) avval o‘chiriladi (Trip → Order FK), so‘ng haydovchi.
   * Faol / nizo ostidagi safarlar — operatsion xavfsizlik uchun baribir bloklanadi.
   */
  async deleteDriverAccount(
    driverId: string,
    actorUserId?: string,
    audit?: { operatorId?: string },
  ) {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: { select: { id: true, role: true, phone: true } } },
    });
    if (!d) {
      throw new NotFoundException("Driver not found");
    }
    if (d.user.role !== UserRole.DRIVER) {
      throw new BadRequestException(
        "Faqat DRIVER ro‘lidagi hisobni o‘chirish mumkin",
      );
    }
    const blocking = await this.prisma.trip.findFirst({
      where: {
        driverId,
        status: {
          in: [TripStatus.NOT_STARTED, TripStatus.ACTIVE, TripStatus.DISPUTED],
        },
      },
      select: { id: true },
    });
    if (blocking) {
      throw new ConflictException(
        "Faol yoki nizo ostidagi safar bor — avval operatsion yopish kerak.",
      );
    }
    const userId = d.userId;
    const phone = d.user.phone;

    const [tripOrders, assignedOrders] = await Promise.all([
      this.prisma.trip.findMany({
        where: { driverId },
        select: { orderId: true },
      }),
      this.prisma.order.findMany({
        where: { assignedDriverId: driverId },
        select: { id: true },
      }),
    ]);
    const orderIds = [
      ...new Set([
        ...tripOrders.map((t) => t.orderId),
        ...assignedOrders.map((o) => o.id),
      ]),
    ];

    await this.prisma.$transaction(async (tx) => {
      if (orderIds.length > 0) {
        await tx.order.deleteMany({ where: { id: { in: orderIds } } });
      }
      await tx.user.delete({ where: { id: userId } });
    });

    await this.writeAudit(actorUserId, "driver.delete", "User", userId, {
      driverId,
      phone,
      ordersPurged: orderIds.length,
      ...(audit?.operatorId ? { deletedByOperatorId: audit.operatorId } : {}),
    });
    return { ok: true as const, driverId };
  }

  async updateDriverPayoutDestinationByAdmin(
    driverId: string,
    body: { payoutIban?: string | null; payoutAccountName?: string | null },
    actorUserId?: string,
  ) {
    const data: Prisma.DriverUpdateInput = {};
    if (body.payoutIban !== undefined) {
      const t = (body.payoutIban ?? "")
        .trim()
        .replace(/\s+/g, "")
        .toUpperCase();
      data.payoutIban = t.length ? t : null;
    }
    if (body.payoutAccountName !== undefined) {
      const t = (body.payoutAccountName ?? "").trim();
      data.payoutAccountName = t.length ? t : null;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        "Kamida bitta: payoutIban yoki payoutAccountName",
      );
    }
    const ex = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true },
    });
    if (!ex) {
      throw new NotFoundException("Driver not found");
    }
    const d = await this.prisma.driver.update({
      where: { id: driverId },
      data,
      select: { id: true, payoutIban: true, payoutAccountName: true },
    });
    await this.writeAudit(
      actorUserId,
      "driver.payout_destination",
      "Driver",
      driverId,
      { ...d },
    );
    return d;
  }

  async sendTestSms(
    toPhone: string,
    bodyText: string | undefined,
    actorUserId?: string,
  ) {
    const text = (bodyText?.trim() || "Salom Taxi: test SMS (admin)").slice(
      0,
      500,
    );
    const { logId } = await this.sms.sendToCustomer(null, toPhone.trim(), text);
    await this.writeAudit(actorUserId, "sms.test_send", "SMSLog", logId, {
      toPhone: toPhone.trim(),
    });
    return { ok: true as const, logId };
  }

  async updateZoneMeter(
    zoneId: string,
    body: {
      starterFeeUzs?: number;
      waitingFreeMinutes?: number;
      waitingFeePerMinuteUzs?: number;
      meterBaseUzs?: number;
      meterPerKmUzs?: number;
      clearMeter?: boolean;
    },
    actorUserId?: string,
  ) {
    const prev = await this.prisma.serviceZone.findUnique({
      where: { id: zoneId },
    });
    if (!prev) {
      throw new NotFoundException("Zone not found");
    }
    if (body.clearMeter) {
      await this.prisma.serviceZone.update({
        where: { id: zoneId },
        data: { meterBaseUzs: null, meterPerKmUzs: null },
      });
      await this.writeAudit(
        actorUserId,
        "zone.meter.clear",
        "ServiceZone",
        zoneId,
        {
          before: {
            meterBaseUzs: prev.meterBaseUzs?.toString() ?? null,
            meterPerKmUzs: prev.meterPerKmUzs?.toString() ?? null,
          },
        },
      );
      return { ok: true as const, zoneId, cleared: true as const };
    }
    const hasM1 = body.meterBaseUzs !== undefined;
    const hasM2 = body.meterPerKmUzs !== undefined;
    if (hasM1 !== hasM2) {
      throw new BadRequestException(
        "meterBaseUzs va meterPerKmUzs ikkalasi birga yuborilishi kerak",
      );
    }
    const data: Prisma.ServiceZoneUpdateInput = {};
    if (body.starterFeeUzs !== undefined) {
      data.starterFeeUzs = body.starterFeeUzs;
    }
    if (body.waitingFreeMinutes !== undefined) {
      data.waitingFreeMinutes = Math.round(body.waitingFreeMinutes);
    }
    if (body.waitingFeePerMinuteUzs !== undefined) {
      data.waitingFeePerMinuteUzs = body.waitingFeePerMinuteUzs;
    }
    if (hasM1 && hasM2) {
      if (body.meterBaseUzs! < 0 || body.meterPerKmUzs! < 0) {
        throw new BadRequestException("Narx manfiy bo'lmasin");
      }
      data.meterBaseUzs = body.meterBaseUzs;
      data.meterPerKmUzs = body.meterPerKmUzs;
    }
    if (Object.keys(data).length === 0) {
      return { ok: true as const, zoneId, message: "no changes" as const };
    }
    const updated = await this.prisma.serviceZone.update({
      where: { id: zoneId },
      data,
    });
    await this.writeAudit(
      actorUserId,
      "zone.meter.update",
      "ServiceZone",
      zoneId,
      {
        before: {
          starterFeeUzs: prev.starterFeeUzs?.toString() ?? null,
          waitingFreeMinutes: prev.waitingFreeMinutes ?? null,
          waitingFeePerMinuteUzs:
            prev.waitingFeePerMinuteUzs?.toString() ?? null,
          meterBaseUzs: prev.meterBaseUzs?.toString() ?? null,
          meterPerKmUzs: prev.meterPerKmUzs?.toString() ?? null,
        },
        after: {
          starterFeeUzs: updated.starterFeeUzs?.toString() ?? null,
          waitingFreeMinutes: updated.waitingFreeMinutes ?? null,
          waitingFeePerMinuteUzs:
            updated.waitingFeePerMinuteUzs?.toString() ?? null,
          meterBaseUzs: updated.meterBaseUzs?.toString() ?? null,
          meterPerKmUzs: updated.meterPerKmUzs?.toString() ?? null,
        },
      },
    );
    return { ok: true as const, zone: updated };
  }

  listZones() {
    return this.prisma.serviceZone.findMany({
      orderBy: { name: "asc" },
    });
  }

  async getZonePickupPricing(zoneId: string) {
    const z = await this.prisma.serviceZone.findUnique({
      where: { id: zoneId },
    });
    if (!z) {
      throw new NotFoundException("Zone not found");
    }
    const profile = await this.pricingEngine.defaultProfileForZone(zoneId);
    return this.toPickupPricingJson(profile);
  }

  private toPickupPricingJson(
    profile: Awaited<ReturnType<PricingEngineService["defaultProfileForZone"]>>,
  ) {
    return {
      profileId: profile.id,
      serviceZoneId: profile.serviceZoneId,
      freeWaitMinutes: profile.freeWaitMinutes,
      waitPerMinuteUzs: Number(profile.waitPerMinuteUzs),
      cityKmRateUzs: Number(profile.cityKmRateUzs),
      outsideKmRateUzs: Number(profile.outsideKmRateUzs),
      rings: profile.rings.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        radiusFromKm: Number(r.radiusFromKm),
        radiusToKm: r.radiusToKm == null ? null : Number(r.radiusToKm),
        starterFeeUzs: Number(r.starterFeeUzs),
        distanceRateUzs:
          r.distanceRateUzs == null ? null : Number(r.distanceRateUzs),
        sortOrder: r.sortOrder,
      })),
    };
  }

  async patchZonePickupPricing(
    zoneId: string,
    dto: PatchZonePickupPricingDto,
    actorUserId?: string,
  ) {
    const z = await this.prisma.serviceZone.findUnique({
      where: { id: zoneId },
    });
    if (!z) {
      throw new NotFoundException("Zone not found");
    }
    const profile = await this.pricingEngine.defaultProfileForZone(zoneId);
    const data: Prisma.PricingProfileUpdateInput = {};
    if (dto.freeWaitMinutes !== undefined) {
      data.freeWaitMinutes = dto.freeWaitMinutes;
    }
    if (dto.waitPerMinuteUzs !== undefined) {
      data.waitPerMinuteUzs = new Prisma.Decimal(dto.waitPerMinuteUzs);
    }
    if (dto.cityKmRateUzs !== undefined) {
      data.cityKmRateUzs = new Prisma.Decimal(dto.cityKmRateUzs);
    }
    if (dto.outsideKmRateUzs !== undefined) {
      data.outsideKmRateUzs = new Prisma.Decimal(dto.outsideKmRateUzs);
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.pricingProfile.update({
        where: { id: profile.id },
        data,
      });
      await this.writeAudit(
        actorUserId,
        "zone.pickup_pricing.patch",
        "PricingProfile",
        profile.id,
        {
          zoneId,
          dto,
        },
      );
    }
    return this.getZonePickupPricing(zoneId);
  }

  async createPickupPricingRing(
    zoneId: string,
    dto: CreatePickupPricingRingDto,
    actorUserId?: string,
  ) {
    const z = await this.prisma.serviceZone.findUnique({
      where: { id: zoneId },
    });
    if (!z) {
      throw new NotFoundException("Zone not found");
    }
    const profile = await this.pricingEngine.defaultProfileForZone(zoneId);
    const code = dto.code.trim().toLowerCase().slice(0, 40);
    const dup = await this.prisma.pricingRing.findFirst({
      where: { pricingProfileId: profile.id, code },
    });
    if (dup) {
      throw new BadRequestException(`Ring code allaqachon mavjud: ${code}`);
    }
    const ring = await this.prisma.pricingRing.create({
      data: {
        pricingProfileId: profile.id,
        code,
        name: dto.name.trim(),
        radiusFromKm: new Prisma.Decimal(dto.radiusFromKm),
        radiusToKm:
          dto.radiusToKm == null ? null : new Prisma.Decimal(dto.radiusToKm),
        starterFeeUzs: new Prisma.Decimal(dto.starterFeeUzs),
        distanceRateUzs:
          dto.distanceRateUzs == null
            ? null
            : new Prisma.Decimal(dto.distanceRateUzs),
        sortOrder: dto.sortOrder ?? 100,
      },
    });
    await this.writeAudit(
      actorUserId,
      "zone.pickup_ring.create",
      "PricingRing",
      ring.id,
      {
        zoneId,
        code,
      },
    );
    return this.getZonePickupPricing(zoneId);
  }

  async patchPickupPricingRing(
    ringId: string,
    dto: UpdatePickupPricingRingDto,
    actorUserId?: string,
  ) {
    const ring = await this.prisma.pricingRing.findUnique({
      where: { id: ringId },
      include: { pricingProfile: { select: { serviceZoneId: true } } },
    });
    if (!ring) {
      throw new NotFoundException("Ring not found");
    }
    const data: Prisma.PricingRingUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }
    if (dto.radiusFromKm !== undefined) {
      data.radiusFromKm = new Prisma.Decimal(dto.radiusFromKm);
    }
    if (dto.radiusToKm !== undefined) {
      data.radiusToKm =
        dto.radiusToKm == null ? null : new Prisma.Decimal(dto.radiusToKm);
    }
    if (dto.starterFeeUzs !== undefined) {
      data.starterFeeUzs = new Prisma.Decimal(dto.starterFeeUzs);
    }
    if (dto.distanceRateUzs !== undefined) {
      data.distanceRateUzs =
        dto.distanceRateUzs == null
          ? null
          : new Prisma.Decimal(dto.distanceRateUzs);
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.pricingRing.update({ where: { id: ringId }, data });
      await this.writeAudit(
        actorUserId,
        "zone.pickup_ring.patch",
        "PricingRing",
        ringId,
        { dto },
      );
    }
    return this.getZonePickupPricing(ring.pricingProfile.serviceZoneId);
  }

  async deletePickupPricingRing(ringId: string, actorUserId?: string) {
    const ring = await this.prisma.pricingRing.findUnique({
      where: { id: ringId },
      include: {
        pricingProfile: { select: { serviceZoneId: true, id: true } },
      },
    });
    if (!ring) {
      throw new NotFoundException("Ring not found");
    }
    const count = await this.prisma.pricingRing.count({
      where: { pricingProfileId: ring.pricingProfileId },
    });
    if (count <= 1) {
      throw new BadRequestException(
        "Kamida bitta pickup radius ring qolishi kerak",
      );
    }
    await this.prisma.pricingRing.delete({ where: { id: ringId } });
    await this.writeAudit(
      actorUserId,
      "zone.pickup_ring.delete",
      "PricingRing",
      ringId,
      {
        zoneId: ring.pricingProfile.serviceZoneId,
      },
    );
    return this.getZonePickupPricing(ring.pricingProfile.serviceZoneId);
  }

  async createServiceZone(
    body: {
      name: string;
      slug: string;
      centerLat?: number;
      centerLng?: number;
      isActive?: boolean;
    },
    actorUserId?: string,
  ) {
    const slug = body.slug.trim().toLowerCase();
    const dup = await this.prisma.serviceZone.findUnique({ where: { slug } });
    if (dup) {
      throw new BadRequestException(`Zona slug allaqachon mavjud: ${slug}`);
    }
    const hasCenter =
      body.centerLat !== undefined &&
      body.centerLng !== undefined &&
      Number.isFinite(body.centerLat) &&
      Number.isFinite(body.centerLng);
    const s = slug.toLowerCase();
    const starterDefault =
      s.includes("far") || s.includes("tash") || s.includes("outer_far")
        ? 12_000
        : s.includes("outer") || s.includes("qishloq") || s.includes("chekka")
          ? 8_000
          : 5_000;
    const row = await this.prisma.serviceZone.create({
      data: {
        name: body.name.trim(),
        slug,
        isActive: body.isActive !== false,
        centerLat: hasCenter ? new Prisma.Decimal(body.centerLat!) : null,
        centerLng: hasCenter ? new Prisma.Decimal(body.centerLng!) : null,
        starterFeeUzs: new Prisma.Decimal(starterDefault),
        waitingFreeMinutes: 10,
        waitingFeePerMinuteUzs: new Prisma.Decimal(1000),
      },
    });
    await this.writeAudit(actorUserId, "zone.create", "ServiceZone", row.id, {
      name: row.name,
      slug: row.slug,
    });
    return row;
  }

  listOperators() {
    return this.prisma.operator.findMany({
      orderBy: { displayName: "asc" },
      include: {
        user: {
          select: {
            phone: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
          },
        },
        serviceZone: { select: { name: true, id: true, slug: true } },
      },
    });
  }

  async createOperator(
    body: {
      displayName: string;
      phone: string;
      serviceZoneId?: string | null;
      status?: UserAccountStatus;
      password?: string;
    },
    actorUserId?: string,
  ) {
    const displayName = body.displayName.trim();
    if (!displayName) {
      throw new BadRequestException("Operator nomi majburiy");
    }
    const phone = normalizePhoneUz(body.phone);
    const serviceZoneId = body.serviceZoneId?.trim() || null;
    if (serviceZoneId) {
      await this.assertActiveServiceZone(serviceZoneId);
    }
    const pwd = body.password?.trim();
    const passwordHash =
      pwd && pwd.length >= 8 ? await bcrypt.hash(pwd, 10) : undefined;
    const row = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone,
          role: UserRole.OPERATOR,
          status: body.status ?? UserAccountStatus.ACTIVE,
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      return tx.operator.create({
        data: {
          userId: user.id,
          displayName,
          serviceZoneId,
        },
        include: {
          user: {
            select: {
              phone: true,
              status: true,
              createdAt: true,
              lastLoginAt: true,
            },
          },
          serviceZone: { select: { id: true, name: true, slug: true } },
        },
      });
    });
    await this.writeAudit(actorUserId, "operator.create", "Operator", row.id, {
      phone,
      displayName,
      serviceZoneId,
    });
    return row;
  }

  async updateOperator(
    operatorId: string,
    body: {
      displayName?: string;
      phone?: string;
      serviceZoneId?: string | null;
      status?: UserAccountStatus;
      password?: string;
    },
    actorUserId?: string,
  ) {
    const current = await this.prisma.operator.findUnique({
      where: { id: operatorId },
      include: { user: { select: { id: true, phone: true, status: true } } },
    });
    if (!current) {
      throw new NotFoundException("Operator topilmadi");
    }
    const opData: Prisma.OperatorUpdateInput = {};
    const userData: Prisma.UserUpdateInput = {};
    if (body.displayName !== undefined) {
      const displayName = body.displayName.trim();
      if (!displayName)
        throw new BadRequestException("Operator nomi bo‘sh bo‘lmasin");
      opData.displayName = displayName;
    }
    if (body.serviceZoneId !== undefined) {
      const serviceZoneId = body.serviceZoneId?.trim() || null;
      if (serviceZoneId) {
        await this.assertActiveServiceZone(serviceZoneId);
        opData.serviceZone = { connect: { id: serviceZoneId } };
      } else {
        opData.serviceZone = { disconnect: true };
      }
    }
    if (body.phone !== undefined) {
      userData.phone = normalizePhoneUz(body.phone);
    }
    if (body.status !== undefined) {
      userData.status = body.status;
    }
    const pwd = body.password?.trim();
    if (pwd !== undefined) {
      if (pwd.length < 8) {
        throw new BadRequestException("Parol kamida 8 belgi bo‘lishi kerak");
      }
      userData.passwordHash = await bcrypt.hash(pwd, 10);
    }
    await this.prisma.$transaction([
      ...(Object.keys(userData).length
        ? [
            this.prisma.user.update({
              where: { id: current.user.id },
              data: userData,
            }),
          ]
        : []),
      ...(Object.keys(opData).length
        ? [
            this.prisma.operator.update({
              where: { id: operatorId },
              data: opData,
            }),
          ]
        : []),
    ]);
    await this.writeAudit(
      actorUserId,
      "operator.update",
      "Operator",
      operatorId,
      {
        fields: Object.keys(body).filter((k) => k !== "password"),
      },
    );
    return this.getOperator(operatorId);
  }

  setOperatorStatus(
    operatorId: string,
    status: UserAccountStatus,
    actorUserId?: string,
  ) {
    return this.updateOperator(operatorId, { status }, actorUserId);
  }

  async deleteOperator(operatorId: string, actorUserId?: string) {
    const op = await this.prisma.operator.findUnique({
      where: { id: operatorId },
      include: { user: { select: { id: true, phone: true, role: true } } },
    });
    if (!op) {
      throw new NotFoundException("Operator topilmadi");
    }
    if (op.user.role !== UserRole.OPERATOR) {
      throw new BadRequestException(
        "Faqat OPERATOR ro‘lidagi hisobni o‘chirish mumkin",
      );
    }
    await this.prisma.user.delete({ where: { id: op.userId } });
    await this.writeAudit(actorUserId, "operator.delete", "User", op.userId, {
      operatorId,
      phone: op.user.phone,
    });
    return { ok: true as const, operatorId };
  }

  private async getOperator(operatorId: string) {
    return this.prisma.operator.findUniqueOrThrow({
      where: { id: operatorId },
      include: {
        user: {
          select: {
            phone: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
          },
        },
        serviceZone: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  private async assertActiveServiceZone(serviceZoneId: string) {
    const z = await this.prisma.serviceZone.findFirst({
      where: { id: serviceZoneId, isActive: true },
      select: { id: true },
    });
    if (!z) {
      throw new BadRequestException("Xizmat zonasi topilmadi yoki faol emas");
    }
  }

  async addDriverVehicle(
    driverId: string,
    body: {
      plate: string;
      plateRegionCode?: string | null;
      makeModel: string;
      year?: number | null;
      color?: string | null;
    },
    actorUserId?: string,
  ) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, serviceZoneId: true },
    });
    if (!driver) {
      throw new NotFoundException("Driver not found");
    }
    const plate = body.plate.trim();
    const makeModel = body.makeModel.trim();
    if (!plate || !makeModel) {
      throw new BadRequestException("plate va makeModel majburiy");
    }
    const row = await this.prisma.vehicle.create({
      data: {
        driverId,
        plate,
        plateRegionCode: body.plateRegionCode?.trim() || null,
        makeModel,
        year: body.year ?? null,
        color: body.color?.trim() ?? null,
        serviceZoneId: driver.serviceZoneId,
        isActive: true,
      },
    });
    await this.writeAudit(
      actorUserId,
      "vehicle.admin_create",
      "Vehicle",
      row.id,
      { driverId },
    );
    return row;
  }

  async updateDriverVehicle(
    driverId: string,
    vehicleId: string,
    body: Partial<{
      plate: string;
      plateRegionCode: string | null;
      makeModel: string;
      year: number | null;
      color: string | null;
      isActive: boolean;
    }>,
    actorUserId?: string,
  ) {
    const existing = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, driverId },
    });
    if (!existing) {
      throw new NotFoundException("Vehicle not found");
    }
    const data: Prisma.VehicleUpdateInput = {};
    if (body.plate !== undefined) {
      data.plate = body.plate.trim();
    }
    if (body.plateRegionCode !== undefined) {
      data.plateRegionCode = body.plateRegionCode?.trim() || null;
    }
    if (body.makeModel !== undefined) {
      data.makeModel = body.makeModel.trim();
    }
    if (body.year !== undefined) {
      data.year = body.year;
    }
    if (body.color !== undefined) {
      data.color = body.color?.trim() ?? null;
    }
    if (body.isActive !== undefined) {
      data.isActive = body.isActive;
    }
    const row = await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data,
    });
    await this.writeAudit(
      actorUserId,
      "vehicle.admin_update",
      "Vehicle",
      vehicleId,
      { driverId },
    );
    return row;
  }

  async removeDriverVehicle(
    driverId: string,
    vehicleId: string,
    actorUserId?: string,
  ) {
    const r = await this.prisma.vehicle.updateMany({
      where: { id: vehicleId, driverId },
      data: { isActive: false },
    });
    if (r.count === 0) {
      throw new NotFoundException("Vehicle not found");
    }
    await this.writeAudit(
      actorUserId,
      "vehicle.admin_remove",
      "Vehicle",
      vehicleId,
      { driverId },
    );
    return { ok: true as const };
  }

  listVehicles(params: { take: number; skip: number; q?: string }) {
    const where: Prisma.VehicleWhereInput = {};
    if (params.q?.trim()) {
      const q = params.q.trim();
      where.OR = [
        { plate: { contains: q, mode: "insensitive" } },
        { makeModel: { contains: q, mode: "insensitive" } },
      ];
    }
    return this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        take: params.take,
        skip: params.skip,
        orderBy: { updatedAt: "desc" },
        include: {
          driver: {
            include: { user: { select: { phone: true } } },
          },
          serviceZone: { select: { name: true } },
        },
      }),
      this.prisma.vehicle.count({ where }),
    ]);
  }

  listSubscriptionPackages() {
    return this.prisma.subscriptionPackage.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
  }

  listSubscriptions(params: { take: number; skip: number }) {
    return this.prisma.$transaction([
      this.prisma.driverSubscription.findMany({
        take: params.take,
        skip: params.skip,
        orderBy: { endAt: "desc" },
        include: {
          package: true,
          driver: { include: { user: { select: { phone: true } } } },
          serviceZone: { select: { name: true } },
        },
      }),
      this.prisma.driverSubscription.count(),
    ]);
  }

  async financeSummary() {
    const [earn30, comm30, payOut, drivers] = await Promise.all([
      this.prisma.earningsLedger.aggregate({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 86400_000) },
        },
        _sum: { amountUzs: true },
      }),
      this.prisma.commissionLedger.aggregate({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
        _sum: { amountUzs: true },
      }),
      this.prisma.earningsLedger.aggregate({
        where: {
          type: EarningsLedgerType.PAYOUT,
          createdAt: { gte: new Date(Date.now() - 30 * 86400_000) },
        },
        _sum: { amountUzs: true },
      }),
      this.prisma.driver.aggregate({ _sum: { balanceUzs: true } }),
    ]);
    return {
      windowDays: 30,
      earningsNetSum30dUzs: earn30._sum.amountUzs?.toString() ?? "0",
      commissionSum30dUzs: comm30._sum.amountUzs?.toString() ?? "0",
      payoutSum30dUzs: payOut._sum.amountUzs
        ? Number(payOut._sum.amountUzs)
        : 0,
      totalDriverBalanceUzs: drivers._sum.balanceUzs?.toString() ?? "0",
    };
  }

  listAuditLogs(take: number, actionContains?: string) {
    const ac = actionContains?.trim();
    return this.prisma.auditLog.findMany({
      take: Math.min(take, 200),
      where: ac
        ? {
            action: { contains: ac, mode: "insensitive" as const },
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { phone: true, role: true } } },
    });
  }

  listRecentPayouts(take: number) {
    return this.prisma.earningsLedger.findMany({
      where: { type: EarningsLedgerType.PAYOUT },
      take: Math.min(take, 100),
      orderBy: { createdAt: "desc" },
      include: {
        driver: { include: { user: { select: { phone: true } } } },
      },
    });
  }

  listTopDriverBalances(take: number) {
    return this.prisma.driver.findMany({
      take: Math.min(take, 50),
      orderBy: { balanceUzs: "desc" },
      include: { user: { select: { phone: true, status: true } } },
    });
  }

  private ledgerWhere(params: {
    driverId?: string;
    type?: string;
    from?: string;
    to?: string;
    q?: string;
  }): Prisma.EarningsLedgerWhereInput {
    const where: Prisma.EarningsLedgerWhereInput = {};
    if (params.driverId?.trim()) {
      where.driverId = params.driverId.trim();
    }
    if (params.type?.trim()) {
      const t = params.type.trim();
      if (Object.values(EarningsLedgerType).includes(t as EarningsLedgerType)) {
        where.type = t as EarningsLedgerType;
      }
    }
    const createdAt: Prisma.DateTimeFilter = {};
    if (params.from?.trim()) {
      const d = new Date(params.from);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (params.to?.trim()) {
      const d = new Date(params.to);
      if (!Number.isNaN(d.getTime())) createdAt.lte = d;
    }
    if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;
    if (params.q?.trim()) {
      const q = params.q.trim();
      where.OR = [
        { note: { contains: q, mode: "insensitive" } },
        { driver: { user: { phone: { contains: q, mode: "insensitive" } } } },
      ];
    }
    return where;
  }

  async listFinanceLedger(params: {
    take: number;
    skip: number;
    driverId?: string;
    type?: string;
    from?: string;
    to?: string;
    q?: string;
  }) {
    const take = Math.min(Math.max(params.take, 1), 200);
    const skip = Math.max(params.skip, 0);
    const where = this.ledgerWhere(params);
    const [items, total] = await Promise.all([
      this.prisma.earningsLedger.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: "desc" },
        include: {
          driver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              balanceUzs: true,
              user: { select: { phone: true, status: true } },
            },
          },
          order: {
            select: {
              id: true,
              pickupLandmark: true,
              customerPhone: true,
              status: true,
            },
          },
          trip: {
            select: {
              id: true,
              status: true,
              endedAt: true,
              grossUzs: true,
              commissionUzs: true,
            },
          },
        },
      }),
      this.prisma.earningsLedger.count({ where }),
    ]);
    return {
      total,
      take,
      skip,
      items: items.map((r) => ({
        id: r.id,
        driverId: r.driverId,
        type: r.type,
        amountUzs: r.amountUzs.toString(),
        balanceAfterUzs: r.balanceAfterUzs?.toString() ?? null,
        orderId: r.orderId,
        tripId: r.tripId,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        driver: {
          id: r.driver.id,
          phone: r.driver.user.phone,
          accountStatus: r.driver.user.status,
          firstName: r.driver.firstName,
          lastName: r.driver.lastName,
          balanceUzs: r.driver.balanceUzs.toString(),
        },
        order: r.order,
        trip: r.trip
          ? {
              ...r.trip,
              grossUzs: r.trip.grossUzs?.toString() ?? null,
              commissionUzs: r.trip.commissionUzs?.toString() ?? null,
            }
          : null,
      })),
    };
  }

  async reconcileDriverBalance(driverId: string) {
    return this.ledger.reconcileDriverBalance(driverId);
  }

  async dailyOrderStats(days: number) {
    const d = Math.min(Math.max(days, 1), 30);
    const out: {
      date: string;
      created: number;
      completed: number;
      gmvUzs: number;
      commissionUzs: number;
    }[] = [];
    for (let i = d - 1; i >= 0; i -= 1) {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() - i);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      const [created, completed, gmv, commission] = await Promise.all([
        this.prisma.order.count({
          where: { createdAt: { gte: start, lt: end } },
        }),
        this.prisma.order.count({
          where: {
            status: OrderStatus.COMPLETED,
            updatedAt: { gte: start, lt: end },
          },
        }),
        this.prisma.trip.aggregate({
          where: {
            status: TripStatus.COMPLETED,
            endedAt: { gte: start, lt: end },
            grossUzs: { not: null },
          },
          _sum: { grossUzs: true },
        }),
        this.prisma.commissionLedger.aggregate({
          where: { createdAt: { gte: start, lt: end } },
          _sum: { amountUzs: true },
        }),
      ]);
      out.push({
        date: start.toISOString().slice(0, 10),
        created,
        completed,
        gmvUzs: gmv._sum.grossUzs ? Number(gmv._sum.grossUzs) : 0,
        commissionUzs: commission._sum.amountUzs
          ? Number(commission._sum.amountUzs)
          : 0,
      });
    }
    return { days: d, series: out };
  }

  listRecentAdjustments(take: number) {
    return this.prisma.earningsLedger.findMany({
      where: {
        type: {
          in: [
            EarningsLedgerType.ADJUSTMENT,
            EarningsLedgerType.MANUAL_ADJUSTMENT_PLUS,
            EarningsLedgerType.MANUAL_ADJUSTMENT_MINUS,
          ],
        },
      },
      take: Math.min(take, 100),
      orderBy: { createdAt: "desc" },
      include: {
        driver: { include: { user: { select: { phone: true } } } },
      },
    });
  }

  listRecentTopUps(take: number) {
    return this.prisma.earningsLedger.findMany({
      where: { type: EarningsLedgerType.TOP_UP },
      take: Math.min(take, 100),
      orderBy: { createdAt: "desc" },
      include: {
        driver: { include: { user: { select: { phone: true } } } },
      },
    });
  }

  listSmsLogs(take: number, statusFilter?: string) {
    const allowed = new Set<string>(Object.values(SmsDeliveryStatus));
    const st = statusFilter?.trim();
    const where =
      st && allowed.has(st) ? { status: st as SmsDeliveryStatus } : undefined;
    return this.prisma.sMSLog.findMany({
      take: Math.min(take, 200),
      where,
      orderBy: { createdAt: "desc" },
      include: { order: { select: { id: true, status: true } } },
    });
  }

  async recordPayout(
    body: { driverId: string; amountUzs: number; note?: string },
    actorUserId?: string,
  ) {
    const mutation = await this.prisma.$transaction((tx) =>
      this.ledger.recordPayout(tx, body),
    );
    await this.writeAudit(
      actorUserId,
      "finance.payout",
      "Driver",
      body.driverId,
      {
        amountUzs: body.amountUzs,
        ledgerId: mutation.ledgerId,
        previousBalanceUzs: mutation.previousBalance.toString(),
        newBalanceUzs: mutation.newBalance.toString(),
      },
    );
    const row = await this.prisma.earningsLedger.findUnique({
      where: { id: mutation.ledgerId },
    });
    return { ok: true as const, ledger: row };
  }

  async recordTopUp(
    body: { driverId: string; amountUzs: number; note?: string },
    actorUserId?: string,
  ) {
    const mutation = await this.prisma.$transaction((tx) =>
      this.ledger.recordTopUp(tx, body),
    );
    await this.writeAudit(
      actorUserId,
      "finance.top_up",
      "Driver",
      body.driverId,
      {
        amountUzs: body.amountUzs,
        ledgerId: mutation.ledgerId,
        previousBalanceUzs: mutation.previousBalance.toString(),
        newBalanceUzs: mutation.newBalance.toString(),
      },
    );
    const row = await this.prisma.earningsLedger.findUnique({
      where: { id: mutation.ledgerId },
    });
    return { ok: true as const, ledger: row };
  }

  async recordLedgerAdjustment(
    body: { driverId: string; amountUzs: number; note?: string },
    actorUserId?: string,
  ) {
    const mutation = await this.prisma.$transaction((tx) =>
      this.ledger.recordManualAdjustment(tx, body),
    );
    await this.writeAudit(
      actorUserId,
      "finance.adjustment",
      "Driver",
      body.driverId,
      {
        amountUzs: body.amountUzs,
        type: mutation.type,
        ledgerId: mutation.ledgerId,
        previousBalanceUzs: mutation.previousBalance.toString(),
        newBalanceUzs: mutation.newBalance.toString(),
      },
    );
    const row = await this.prisma.earningsLedger.findUnique({
      where: { id: mutation.ledgerId },
    });
    return { ok: true as const, ledger: row };
  }

  listSmsTemplates() {
    return this.prisma.smsTemplate.findMany({ orderBy: { code: "asc" } });
  }

  async updateSmsTemplate(
    code: string,
    body: { bodyUz?: string; isActive?: boolean },
    actorUserId?: string,
  ) {
    const c = code.trim();
    if (!c) {
      throw new BadRequestException("code");
    }
    const cur = await this.prisma.smsTemplate.findUnique({
      where: { code: c },
    });
    if (!cur) {
      throw new NotFoundException("Shablon topilmadi");
    }
    if (body.bodyUz === undefined && body.isActive === undefined) {
      throw new BadRequestException("bodyUz yoki isActive bering");
    }
    const data: Prisma.SmsTemplateUpdateInput = {};
    if (body.bodyUz !== undefined) {
      data.bodyUz = body.bodyUz;
    }
    if (body.isActive !== undefined) {
      data.isActive = body.isActive;
    }
    const updated = await this.prisma.smsTemplate.update({
      where: { code: c },
      data,
    });
    await this.writeAudit(
      actorUserId,
      "sms_template.update",
      "SmsTemplate",
      updated.id,
      { code: c },
    );
    return updated;
  }

  /** Kunlik ro'yxat (UTC kunlar) — buyurtmalar + GMV + komissiya. */
  async exportDailyOrderStatsCsv(days: number): Promise<string> {
    const d = await this.dailyOrderStats(days);
    const header = "date,ordersCreated,ordersCompleted,gmvUzs,commissionUzs\n";
    const lines = d.series.map((r) =>
      [r.date, r.created, r.completed, r.gmvUzs, r.commissionUzs].join(","),
    );
    return header + lines.join("\n") + "\n";
  }

  async exportPilotReportCsv(days: number): Promise<string> {
    const p = await this.pilotOpsReport(days);
    const lines: string[] = [];
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    lines.push("section,type,key,value");
    const w = p.window;
    lines.push(
      `summary,window,fromUtc,${esc(w.fromUtc)}`,
      `summary,window,toUtc,${esc(w.toUtc)}`,
      `summary,window,days,${w.days}`,
      `summary,kpi,ordersCreated,${p.ordersCreated}`,
      `summary,kpi,ordersCompleted,${p.ordersCompleted}`,
      `summary,kpi,ordersCancelled,${p.ordersCancelled}`,
      `summary,kpi,completionRate,${p.completionRate}`,
      `summary,kpi,gmvUzs,${p.gmvUzs}`,
      `summary,kpi,commissionUzs,${p.commissionUzs}`,
    );
    for (const c of p.cancelReasons) {
      lines.push(`cancel,reason,${esc(c.label)},${c.count}`);
    }
    for (const z of p.zoneStats) {
      lines.push(
        `zone,${esc(z.name)},${esc(String(z.serviceZoneId ?? ""))},${z.orders}`,
      );
    }
    for (const d of p.driverPerformance) {
      lines.push(
        `driver,${esc(d.phone)},${esc(d.driverId)},${d.tripsCompleted}`,
      );
    }
    for (const [i, c] of p.pilotChecklist.entries()) {
      lines.push(`checklist,item${i + 1},,${esc(c)}`);
    }
    return lines.join("\n") + "\n";
  }

  /** CSV: PAYOUT + ADJUSTMENT + TRIP_EARNINGS (bank / buxgalteriya eksporti). */
  async exportLedgerCsv(params: {
    take: number;
    driverId?: string;
    type?: string;
    from?: string;
    to?: string;
    q?: string;
  }): Promise<string> {
    const n = Math.min(Math.max(params.take, 1), 5000);
    const where = this.ledgerWhere(params);
    const rows = await this.prisma.earningsLedger.findMany({
      where,
      take: n,
      orderBy: { createdAt: "desc" },
      include: {
        driver: { include: { user: { select: { phone: true } } } },
      },
    });
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = [
      "id",
      "createdAtUtc",
      "type",
      "amountUzs",
      "balanceAfterUzs",
      "driverPhone",
      "note",
    ].join(",");
    const lines = rows.map((r) =>
      [
        esc(r.id),
        esc(r.createdAt.toISOString()),
        esc(r.type),
        esc(r.amountUzs.toString()),
        esc(r.balanceAfterUzs?.toString() ?? ""),
        esc(r.driver.user.phone),
        esc((r.note ?? "").replace(/\r?\n/g, " ")),
      ].join(","),
    );
    return `${header}\n${lines.join("\n")}\n`;
  }

  /**
   * CSV: faqat PAYOUT qatorlari — bank fayl / batch uchun (IBAN alohida to‘ldiriladi).
   * amountUzs musbat (ledgerdagi yechim).
   */
  async exportPayoutsBankBatchCsv(take: number): Promise<string> {
    const n = Math.min(Math.max(take, 1), 5000);
    const rows = await this.prisma.earningsLedger.findMany({
      where: { type: EarningsLedgerType.PAYOUT },
      take: n,
      orderBy: { createdAt: "desc" },
      include: {
        driver: {
          select: { payoutIban: true, user: { select: { phone: true } } },
        },
      },
    });
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = [
      "createdAtUtc",
      "amountUzs",
      "driverPhone",
      "driverId",
      "ledgerId",
      "payoutIban",
      "note",
    ].join(",");
    const lines = rows.map((r) =>
      [
        esc(r.createdAt.toISOString()),
        esc(r.amountUzs.toString()),
        esc(r.driver.user.phone),
        esc(r.driverId),
        esc(r.id),
        esc(r.driver.payoutIban?.trim() ?? ""),
        esc((r.note ?? "").replace(/\r?\n/g, " ")),
      ].join(","),
    );
    return `${header}\n${lines.join("\n")}\n`;
  }

  /** Pilot / launch: KPIlar, zonalar, bekor sabablari, haydovchi statistikasi. */
  async pilotOpsReport(days: number) {
    const d = Math.min(Math.max(days, 1), 90);
    const to = new Date();
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - d);
    from.setUTCHours(0, 0, 0, 0);

    const cancelStatuses: OrderStatus[] = [
      OrderStatus.CANCELLED_BY_OPERATOR,
      OrderStatus.CANCELLED_BY_DRIVER,
      OrderStatus.CANCELLED_BY_PASSENGER,
      OrderStatus.EXPIRED,
    ];

    const createdN = await this.prisma.order.count({
      where: { createdAt: { gte: from } },
    });
    const completedN = await this.prisma.order.count({
      where: { status: OrderStatus.COMPLETED, updatedAt: { gte: from } },
    });
    const cancelledN = await this.prisma.order.count({
      where: { status: { in: cancelStatuses }, updatedAt: { gte: from } },
    });
    const gmv = await this.prisma.trip.aggregate({
      where: {
        status: TripStatus.COMPLETED,
        endedAt: { gte: from },
        grossUzs: { not: null },
      },
      _sum: { grossUzs: true },
    });
    const commission = await this.prisma.commissionLedger.aggregate({
      where: { createdAt: { gte: from } },
      _sum: { amountUzs: true },
    });
    const reasonGroups = await this.prisma.order.groupBy({
      by: ["cancellationReasonId"],
      where: {
        status: { in: cancelStatuses },
        updatedAt: { gte: from },
      },
      _count: { _all: true },
    });
    const zoneGroups = await this.prisma.order.groupBy({
      by: ["serviceZoneId"],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
    });
    const topTrips = await this.prisma.trip.groupBy({
      by: ["driverId"],
      where: { status: TripStatus.COMPLETED, endedAt: { gte: from } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 12,
    });

    const finished = completedN + cancelledN;
    const completionRate =
      finished > 0 ? Math.round((completedN / finished) * 1000) / 1000 : 0;
    const reasonIds = reasonGroups
      .map((g) => g.cancellationReasonId)
      .filter((x): x is string => x != null);
    const reasonLabels = await this.prisma.cancellationReason.findMany({
      where: { id: { in: reasonIds } },
    });
    const labelById = new Map(reasonLabels.map((r) => [r.id, r.labelUz]));
    const cancelReasons = reasonGroups.map((g) => ({
      reasonId: g.cancellationReasonId,
      label: g.cancellationReasonId
        ? (labelById.get(g.cancellationReasonId) ?? "—")
        : "(sabab kiritilmagan)",
      count: g._count._all,
    }));

    const zoneIds = zoneGroups
      .map((g) => g.serviceZoneId)
      .filter((x): x is string => x != null);
    const zones = await this.prisma.serviceZone.findMany({
      where: { id: { in: zoneIds } },
      select: { id: true, name: true },
    });
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));
    const zoneStats = zoneGroups.map((g) => ({
      serviceZoneId: g.serviceZoneId,
      name: g.serviceZoneId
        ? (zoneName.get(g.serviceZoneId) ?? g.serviceZoneId)
        : "(zona yo‘q)",
      orders: g._count._all,
    }));

    const driverIds = topTrips.map((t) => t.driverId);
    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: driverIds } },
      include: { user: { select: { phone: true } } },
    });
    const phoneByDriver = new Map(drivers.map((d) => [d.id, d.user.phone]));
    const driverTop = topTrips.map((t) => ({
      driverId: t.driverId,
      phone: phoneByDriver.get(t.driverId) ?? "—",
      tripsCompleted: t._count.id,
    }));

    const gmvUzs = gmv._sum.grossUzs ? Number(gmv._sum.grossUzs) : 0;
    const commissionUzs = commission._sum.amountUzs
      ? Number(commission._sum.amountUzs)
      : 0;

    const orderFinanceByDay = (await this.dailyOrderStats(d)).series;

    return {
      window: { fromUtc: from.toISOString(), toUtc: to.toISOString(), days: d },
      ordersCreated: createdN,
      ordersCompleted: completedN,
      ordersCancelled: cancelledN,
      completionRate,
      gmvUzs,
      commissionUzs,
      cancelReasons,
      zoneStats,
      driverPerformance: driverTop,
      orderFinanceByDay,
      pilotChecklist: [
        "ALLOW_LEGACY_AUTH_HEADERS=false — barcha klientlarda Bearer tekshirilgan",
        "Operator JWT + haydovchi exchange real qurilmada",
        "SMS_MODE=http yoki provayder webhook",
        "Payout + CSV eksport (moliya)",
      ],
    };
  }

  /**
   * Phase 20: uzluksiz `YYYY-MM` (UTC) — `Trip.endedAt` oraliqida, platform komissiyalari.
   */
  async commissionMonthlyByPeriod(periodYm: string) {
    const re = /^(\d{4})-(\d{2})$/.exec(periodYm.trim());
    if (!re) {
      throw new BadRequestException("periodYm: YYYY-MM (mas. 2026-04)");
    }
    const y = parseInt(re[1], 10);
    const mo = parseInt(re[2], 10) - 1;
    if (mo < 0 || mo > 11) {
      throw new BadRequestException("Oy 01–12");
    }
    const from = new Date(Date.UTC(y, mo, 1, 0, 0, 0, 0));
    const to = new Date(Date.UTC(y, mo + 1, 1, 0, 0, 0, 0));

    const trips = await this.prisma.trip.findMany({
      where: { status: TripStatus.COMPLETED, endedAt: { gte: from, lt: to } },
      select: {
        id: true,
        driverId: true,
        commissionRows: { select: { amountUzs: true } },
        driver: { include: { user: { select: { phone: true } } } },
      },
    });
    const map = new Map<
      string,
      { commissionUzs: number; tripCount: number; phone: string }
    >();
    for (const t of trips) {
      const cur = map.get(t.driverId) ?? {
        commissionUzs: 0,
        tripCount: 0,
        phone: t.driver.user.phone,
      };
      for (const c of t.commissionRows) {
        cur.commissionUzs += Number(c.amountUzs);
      }
      cur.tripCount += 1;
      map.set(t.driverId, cur);
    }
    const totalCommissionUzs = [...map.values()].reduce(
      (a, b) => a + b.commissionUzs,
      0,
    );
    return {
      periodYm: `${re[1]}-${re[2]}`,
      fromUtc: from.toISOString(),
      toUtcExcl: to.toISOString(),
      driverCount: map.size,
      totalCommissionUzs,
      items: [...map.entries()].map(([driverId, v]) => ({
        driverId,
        phone: v.phone,
        tripCount: v.tripCount,
        commissionDueUzs: v.commissionUzs,
      })),
    };
  }

  async persistMonthlySettlements(periodYm: string, actorUserId?: string) {
    const r = await this.commissionMonthlyByPeriod(periodYm);
    for (const it of r.items) {
      await this.prisma.driverMonthSettlement.upsert({
        where: {
          driverId_periodYm: { driverId: it.driverId, periodYm: r.periodYm },
        },
        create: {
          driverId: it.driverId,
          periodYm: r.periodYm,
          tripCount: it.tripCount,
          commissionDueUzs: it.commissionDueUzs,
          status: DriverMonthSettlementStatus.PENDING,
        },
        update: {
          tripCount: it.tripCount,
          commissionDueUzs: it.commissionDueUzs,
        },
      });
    }
    await this.writeAudit(
      actorUserId,
      "finance.settlement.sync",
      "Month",
      null,
      {
        periodYm: r.periodYm,
        drivers: r.items.length,
      },
    );
    return { ok: true as const, periodYm: r.periodYm, updated: r.items.length };
  }

  async upsertMonthlyLeaderboardOverride(
    actorUserId: string | undefined,
    body: { driverId: string; periodYm: string; score: number; trips: number },
  ) {
    const driverId = body.driverId.trim();
    const periodYm = body.periodYm.trim().slice(0, 7);
    const score = Math.max(0, Math.trunc(body.score));
    const trips = Math.max(0, Math.trunc(body.trips));

    // Base snapshot: current real stats in that month. Later trips/cancels are applied on top of override.
    const m = /^(\d{4})-(\d{2})$/.exec(periodYm);
    if (!m) {
      throw new BadRequestException("periodYm: YYYY-MM");
    }
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const from = new Date(Date.UTC(y, mo, 1, 0, 0, 0, 0));
    const to = new Date(Date.UTC(y, mo + 1, 1, 0, 0, 0, 0));
    const [baseTrips, baseCancels] = await Promise.all([
      this.prisma.trip.count({
        where: {
          driverId,
          status: TripStatus.COMPLETED,
          endedAt: { gte: from, lt: to },
        },
      }),
      this.prisma.order.count({
        where: {
          assignedDriverId: driverId,
          status: OrderStatus.CANCELLED_BY_DRIVER,
          updatedAt: { gte: from, lt: to },
        },
      }),
    ]);

    const row = await this.prisma.driverLeaderboardOverride.upsert({
      where: { driverId_periodYm: { driverId, periodYm } },
      create: {
        driverId,
        periodYm,
        score,
        trips,
        baseTrips,
        baseCancels,
        updatedByUserId: actorUserId ?? null,
      },
      update: {
        score,
        trips,
        baseTrips,
        baseCancels,
        updatedByUserId: actorUserId ?? null,
      },
      select: {
        id: true,
        driverId: true,
        periodYm: true,
        score: true,
        trips: true,
        updatedAt: true,
      },
    });

    await this.writeAudit(
      actorUserId,
      "gamification.leaderboard_override",
      "DriverLeaderboardOverride",
      row.id,
      {
        driverId,
        periodYm,
        score,
        trips,
      },
    );

    return row;
  }

  async advanceChampionsMonthOverride(actorUserId?: string) {
    const now = new Date();
    const currentYm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const row = await this.prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: { championsPeriodYmOverride: true },
    });
    const base = (row?.championsPeriodYmOverride?.trim() || currentYm).slice(
      0,
      7,
    );
    const next = (() => {
      const m = /^(\d{4})-(\d{2})$/.exec(base);
      if (!m) return currentYm;
      const y = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      const d = new Date(
        Date.UTC(y, Math.max(0, Math.min(11, mm - 1)), 1, 0, 0, 0, 0),
      );
      d.setUTCMonth(d.getUTCMonth() + 1);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    })();

    await this.prisma.platformSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        championsPeriodYmOverride: next,
      },
      update: {
        championsPeriodYmOverride: next,
      },
    });
    await this.writeAudit(
      actorUserId,
      "gamification.champions_month_advance",
      "PlatformSettings",
      null,
      {
        fromYm: base,
        toYm: next,
        settingsRowId: "default",
      },
    );
    return { ok: true as const, fromYm: base, toYm: next };
  }

  async clearChampionsMonthOverride(actorUserId?: string) {
    await this.prisma.platformSettings.upsert({
      where: { id: "default" },
      create: { id: "default", championsPeriodYmOverride: null },
      update: { championsPeriodYmOverride: null },
    });
    await this.writeAudit(
      actorUserId,
      "gamification.champions_month_override_clear",
      "PlatformSettings",
      null,
      {
        settingsRowId: "default",
      },
    );
    return { ok: true as const };
  }

  async getDriverXpGamificationSettings() {
    return this.gamification.getXpTierBonusesAdminSettings();
  }

  async patchDriverXpGamificationSettings(
    actorUserId: string | undefined,
    body: PatchDriverXpSettingsDto,
  ) {
    const r = await this.gamification.patchXpTierBonusesForAdmin(
      body.tierBonusesUzs ?? {},
    );
    // `AuditLog.entityId` — UUID; platform qatori `id = 'default'` UUID emas.
    await this.writeAudit(
      actorUserId,
      "gamification.driver_xp_tier_bonuses",
      "PlatformSettings",
      null,
      {
        settingsRowId: "default",
        ...r,
      },
    );
    return r;
  }

  async upsertDriverLifetimeXpOverrideAdmin(
    actorUserId: string | undefined,
    driverId: string,
    xp: number,
  ) {
    const did = driverId.trim();
    await this.gamification.upsertDriverLifetimeXpOverride({
      driverId: did,
      targetXp: xp,
      updatedByUserId: actorUserId ?? null,
    });
    await this.writeAudit(
      actorUserId,
      "gamification.driver_xp_override",
      "DriverLifetimeXpOverride",
      did,
      { xp },
    );
    return { ok: true as const };
  }

  async deleteDriverLifetimeXpOverrideAdmin(
    actorUserId: string | undefined,
    driverId: string,
  ) {
    const did = driverId.trim();
    await this.gamification.deleteDriverLifetimeXpOverride(did);
    await this.writeAudit(
      actorUserId,
      "gamification.driver_xp_override_clear",
      "DriverLifetimeXpOverride",
      did,
      {},
    );
    return { ok: true as const };
  }

  async listDriverMonthSettlements(periodYm: string) {
    const rows = await this.prisma.driverMonthSettlement.findMany({
      where: { periodYm: periodYm.trim() },
      orderBy: { commissionDueUzs: "desc" },
      include: { driver: { include: { user: { select: { phone: true } } } } },
    });
    return {
      total: rows.length,
      items: rows.map((x) => ({
        id: x.id,
        driverId: x.driverId,
        phone: x.driver.user.phone,
        periodYm: x.periodYm,
        tripCount: x.tripCount,
        commissionDueUzs: x.commissionDueUzs.toString(),
        status: x.status,
        confirmedAt: x.confirmedAt,
        chargedAt: x.chargedAt,
        createdAt: x.createdAt,
      })),
    };
  }

  async confirmDriverMonthSettlement(
    id: string,
    actorUserId?: string,
    body?: { notes?: string | null },
  ) {
    const r = await this.prisma.driverMonthSettlement.findUnique({
      where: { id },
    });
    if (!r) {
      throw new NotFoundException("Qator topilmadi");
    }
    const u = await this.prisma.driverMonthSettlement.update({
      where: { id },
      data: {
        status: DriverMonthSettlementStatus.CONFIRMED,
        confirmedAt: new Date(),
        notes:
          body?.notes !== undefined
            ? body.notes
              ? body.notes.trim()
              : null
            : undefined,
      },
    });
    await this.writeAudit(
      actorUserId,
      "finance.settlement.confirm",
      "DriverMonthSettlement",
      id,
      {
        periodYm: u.periodYm,
      },
    );
    return { ok: true as const, id: u.id, status: u.status };
  }

  /**
   * Yangilik / e’lon: tasdiqlangan haydovchilarga Socket (`driver:notice`, admin_news) va/yoki FCM push.
   */
  async sendDriverBroadcast(dto: SendDriverBroadcastDto, actorUserId?: string) {
    const title = dto.title.trim();
    const body = dto.body.trim();
    if (!title) {
      throw new BadRequestException("title bo‘sh bo‘lmasin");
    }
    if (!body) {
      throw new BadRequestException("body bo‘sh bo‘lmasin");
    }

    const useSocket = dto.channels?.socket !== false;
    const usePush = dto.channels?.push !== false;
    const listOnly =
      dto.channels != null &&
      dto.channels.socket === false &&
      dto.channels.push === false;
    if (!listOnly && !useSocket && !usePush) {
      throw new BadRequestException("Kamida bitta kanal: socket yoki push");
    }

    const maxTargets =
      this.config.get<number>("ADMIN_DRIVER_BROADCAST_MAX_TARGETS") ?? 15_000;

    const ids = await this.resolveBroadcastDriverIds(dto);
    if (ids.length === 0) {
      throw new BadRequestException("Hech qanday haydovchi topilmadi");
    }
    if (ids.length > maxTargets) {
      throw new BadRequestException(
        `Juda ko‘p qabul qiluvchi (${ids.length}). Maksimum ${maxTargets}. Zonani toraytiring yoki ADMIN_DRIVER_BROADCAST_MAX_TARGETS.`,
      );
    }

    let socketEmitted = 0;
    let pushAttempted = 0;
    let pushDelivered = 0;

    if (!listOnly) {
      const batchSize = 40;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (driverId) => {
            if (useSocket) {
              this.driverWs.emitDriverNotice(driverId, {
                v: 1,
                id: randomUUID(),
                category: "admin_news",
                title,
                body,
                occurredAt: new Date().toISOString(),
              });
              socketEmitted++;
            }
            if (usePush) {
              pushAttempted++;
              const r = await this.push.notifyDriver(
                driverId,
                null,
                "admin_news",
                body,
                undefined,
                { pushTitle: title },
              );
              if (r.delivered) pushDelivered++;
            }
          }),
        );
      }
    }

    await this.writeAudit(
      actorUserId,
      "notification.driver_broadcast",
      "Broadcast",
      null,
      {
        audience: dto.audience,
        targeted: ids.length,
        socketEmitted,
        pushAttempted,
        pushDelivered,
        useSocket,
        usePush,
        listOnly,
      },
    );

    await this.prisma.adminNewsBroadcast.create({
      data: {
        title,
        body,
        audience: dto.audience,
        serviceZoneId:
          dto.audience === DriverBroadcastAudience.ZONE
            ? (dto.serviceZoneId ?? null)
            : null,
        targetDriverId:
          dto.audience === DriverBroadcastAudience.SINGLE_DRIVER
            ? (dto.driverId ?? null)
            : null,
        targetedCount: ids.length,
      },
    });

    return {
      ok: true as const,
      audience: dto.audience,
      targeted: ids.length,
      socketEmitted,
      pushAttempted,
      pushDelivered,
      listOnly,
    };
  }

  async listAdminDriverNews(takeRaw: number, skipRaw: number) {
    const take = Math.min(100, Math.max(1, Math.floor(takeRaw)));
    const skip = Math.max(0, Math.floor(skipRaw));
    const [total, rows] = await Promise.all([
      this.prisma.adminNewsBroadcast.count(),
      this.prisma.adminNewsBroadcast.findMany({
        orderBy: { createdAt: "desc" },
        take,
        skip,
        select: {
          id: true,
          title: true,
          body: true,
          audience: true,
          serviceZoneId: true,
          targetDriverId: true,
          targetedCount: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async updateAdminDriverNews(
    id: string,
    dto: UpdateAdminDriverNewsDto,
    actorUserId?: string,
  ) {
    const row = await this.prisma.adminNewsBroadcast.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException("Xabar topilmadi");
    }

    const nextAudience = (dto.audience ??
      row.audience) as DriverBroadcastAudience;
    if (!Object.values(DriverBroadcastAudience).includes(nextAudience)) {
      throw new BadRequestException("Noto‘g‘ri audience");
    }

    const merged: SendDriverBroadcastDto = {
      title: (dto.title?.trim() ?? row.title).trim(),
      body: (dto.body?.trim() ?? row.body).trim(),
      audience: nextAudience,
      serviceZoneId:
        nextAudience === DriverBroadcastAudience.ZONE
          ? (dto.serviceZoneId ?? row.serviceZoneId ?? undefined)
          : undefined,
      driverId:
        nextAudience === DriverBroadcastAudience.SINGLE_DRIVER
          ? (dto.driverId ?? row.targetDriverId ?? undefined)
          : undefined,
    };

    if (!merged.title) {
      throw new BadRequestException("title bo‘sh bo‘lmasin");
    }
    if (!merged.body) {
      throw new BadRequestException("body bo‘sh bo‘lmasin");
    }

    const maxTargets =
      this.config.get<number>("ADMIN_DRIVER_BROADCAST_MAX_TARGETS") ?? 15_000;
    const ids = await this.resolveBroadcastDriverIds(merged);
    if (ids.length === 0) {
      throw new BadRequestException("Hech qanday haydovchi topilmadi");
    }
    if (ids.length > maxTargets) {
      throw new BadRequestException(
        `Juda ko‘p qabul qiluvchi (${ids.length}). Maksimum ${maxTargets}.`,
      );
    }

    await this.prisma.adminNewsBroadcast.update({
      where: { id },
      data: {
        title: merged.title,
        body: merged.body,
        audience: merged.audience,
        serviceZoneId:
          merged.audience === DriverBroadcastAudience.ZONE
            ? (merged.serviceZoneId ?? null)
            : null,
        targetDriverId:
          merged.audience === DriverBroadcastAudience.SINGLE_DRIVER
            ? (merged.driverId ?? null)
            : null,
        targetedCount: ids.length,
      },
    });

    await this.writeAudit(
      actorUserId,
      "notification.driver_news.update",
      "AdminNewsBroadcast",
      id,
      {
        audience: merged.audience,
        targetedCount: ids.length,
      },
    );

    return { ok: true as const };
  }

  async deleteAdminDriverNews(id: string, actorUserId?: string) {
    const row = await this.prisma.adminNewsBroadcast.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException("Xabar topilmadi");
    }
    await this.prisma.adminNewsBroadcast.delete({ where: { id } });
    await this.writeAudit(
      actorUserId,
      "notification.driver_news.delete",
      "AdminNewsBroadcast",
      id,
      {
        title: row.title,
      },
    );
    return { ok: true as const };
  }

  private async resolveBroadcastDriverIds(
    dto: SendDriverBroadcastDto,
  ): Promise<string[]> {
    const approvedActive = {
      user: { status: UserAccountStatus.ACTIVE },
      onboardingStatus: DriverOnboardingStatus.APPROVED,
    };

    if (dto.audience === DriverBroadcastAudience.SINGLE_DRIVER) {
      if (!dto.driverId) {
        throw new BadRequestException("driverId majburiy");
      }
      const d = await this.prisma.driver.findFirst({
        where: { id: dto.driverId, ...approvedActive },
        select: { id: true },
      });
      if (!d) {
        throw new NotFoundException(
          "Haydovchi topilmadi yoki ariza tasdiqlanmagan / hisob aktiv emas",
        );
      }
      return [d.id];
    }

    if (dto.audience === DriverBroadcastAudience.ZONE) {
      if (!dto.serviceZoneId) {
        throw new BadRequestException("serviceZoneId majburiy");
      }
      const z = await this.prisma.serviceZone.findUnique({
        where: { id: dto.serviceZoneId },
        select: { id: true },
      });
      if (!z) {
        throw new NotFoundException("Zona topilmadi");
      }
      const rows = await this.prisma.driver.findMany({
        where: { ...approvedActive, serviceZoneId: dto.serviceZoneId },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }

    const rows = await this.prisma.driver.findMany({
      where: approvedActive,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
