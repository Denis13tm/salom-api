import { Injectable, NotFoundException } from "@nestjs/common";
import { OrderStatus, TripStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { bannerPathsToPublicUrls, parseBannerPathsJson } from "./champions-banners.util";

/** Chempionlar tab preview — qolganlari /monthly-leaderboard orqali */
const MONTHLY_PREVIEW_TOP = 5;

/** Haftalik — UTC (reset bir vaqtda barcha uchun) */
function startOfIsoWeekUtc(now = new Date()): Date {
  const dow = now.getUTCDay();
  const mondayOffset = (dow + 6) % 7;
  const d = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - mondayOffset,
    ),
  );
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfIsoWeekUtc(now = new Date()): Date {
  const s = startOfIsoWeekUtc(now);
  const e = new Date(s);
  e.setUTCDate(e.getUTCDate() + 7);
  return e;
}

function startOfMonthUtc(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

function endOfMonthUtc(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
}

function ymUtc(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthWindowFromYmUtc(ym: string | null | undefined): {
  from: Date;
  to: Date;
  ym: string;
} {
  const now = new Date();
  const defFrom = startOfMonthUtc(now);
  const defTo = endOfMonthUtc(now);
  const defYm = ymUtc(now);
  const s = (ym ?? "").trim();
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return { from: defFrom, to: defTo, ym: defYm };
  const y = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mm) || mm < 1 || mm > 12)
    return { from: defFrom, to: defTo, ym: defYm };
  const from = new Date(Date.UTC(y, mm - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(y, mm, 1, 0, 0, 0, 0));
  return { from, to, ym: `${y}-${String(mm).padStart(2, "0")}` };
}

function endOfQuarterUtc(now = new Date()): Date {
  const q = Math.floor(now.getUTCMonth() / 3);
  const endMonthIdx = [2, 5, 8, 11][q];
  return new Date(
    Date.UTC(now.getUTCFullYear(), endMonthIdx + 1, 0, 23, 59, 59, 999),
  );
}

type RowAgg = {
  driverId: string;
  trips: number;
  ratingAvg: number | null;
  displayName: string;
};

function scoreFromStats(trips: number, driverCancels: number): number {
  const tripPts = trips * 100;
  const penalty = driverCancels * 40;
  return Math.max(0, tripPts - penalty);
}

/** Haydovchi umumiy XP — admin override + keyingi real o‘sishlar. */
export function applyLifetimeXpOverrideReactive(params: {
  realComputedXp: number;
  override: { xp: number; baseComputedXp?: number | null } | null;
}): number {
  if (!params.override) return Math.max(0, Math.trunc(params.realComputedXp));
  const base = Math.max(0, Math.trunc(params.override.baseComputedXp ?? 0));
  const delta = Math.max(0, Math.trunc(params.realComputedXp) - base);
  return Math.max(0, Math.trunc(params.override.xp) + delta);
}

/** Mobil/admin UI: tier jadvali (XP thresholds). */
export const XP_TIER_DEFINITIONS: ReadonlyArray<{
  id: string;
  labelUz: string;
  minXp: number;
}> = [
  { id: "STARTER", labelUz: "START", minXp: 0 },
  { id: "BRONZE", labelUz: "BRONZE", minXp: 500 },
  { id: "SILVER", labelUz: "SILVER", minXp: 1000 },
  { id: "GOLD", labelUz: "GOLD", minXp: 2500 },
  { id: "PLATINUM", labelUz: "PLATINUM", minXp: 5000 },
  { id: "DIAMOND", labelUz: "DIAMOND", minXp: 10000 },
];

export type XpTierWithBonusPayload = {
  id: string;
  labelUz: string;
  minXp: number;
  bonusUzs: number;
};

function applyOverrideReactive(params: {
  realTrips: number;
  realCancels: number;
  override: {
    score: number;
    trips: number;
    baseTrips?: number | null;
    baseCancels?: number | null;
  };
}): { trips: number; score: number } {
  const baseTrips = Math.max(0, Math.trunc(params.override.baseTrips ?? 0));
  const baseCancels = Math.max(0, Math.trunc(params.override.baseCancels ?? 0));
  const deltaTrips = Math.max(0, params.realTrips - baseTrips);
  const deltaCancels = Math.max(0, params.realCancels - baseCancels);
  const trips = Math.max(0, params.override.trips + deltaTrips);
  const score = Math.max(
    0,
    params.override.score + deltaTrips * 100 - deltaCancels * 40,
  );
  return { trips, score };
}

type XpStats = {
  trips: number;
  tripMinutes: number;
  onlineMinutesProxy: number;
  xp: number;
};

@Injectable()
export class GamificationService {
  constructor(private readonly prisma: PrismaService) {}

  private async championsYmOverride(): Promise<string | null> {
    const row = await this.prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: { championsPeriodYmOverride: true },
    });
    const v = row?.championsPeriodYmOverride?.trim() ?? "";
    return v.length ? v.slice(0, 7) : null;
  }

  private async loadDriverXpTierBonusesUzsMap(): Promise<
    Record<string, number>
  > {
    const row = await this.prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: { driverXpTierBonusesUzsJson: true, driverXpBonusUzs: true },
    });
    const uniform = Math.max(0, Math.trunc(row?.driverXpBonusUzs ?? 0));
    const out: Record<string, number> = Object.fromEntries(
      XP_TIER_DEFINITIONS.map((t) => [t.id, 0]),
    );
    const raw = row?.driverXpTierBonusesUzsJson;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const obj = raw as Record<string, unknown>;
      for (const t of XP_TIER_DEFINITIONS) {
        const v = obj[t.id];
        let n = 0;
        if (typeof v === "number" && Number.isFinite(v)) n = Math.trunc(v);
        else if (typeof v === "string" && v.trim().length)
          n = Math.trunc(Number(v.replace(/\s/g, "").replace(/,/g, "")) || 0);
        out[t.id] = Math.max(0, Math.min(100_000_000, n));
      }
      return out;
    }
    for (const t of XP_TIER_DEFINITIONS) out[t.id] = uniform;
    return out;
  }

  async buildXpTiersPublicPayload(): Promise<
    readonly XpTierWithBonusPayload[]
  > {
    const map = await this.loadDriverXpTierBonusesUzsMap();
    return XP_TIER_DEFINITIONS.map((t) => ({
      id: t.id,
      labelUz: t.labelUz,
      minXp: t.minXp,
      bonusUzs: map[t.id] ?? 0,
    }));
  }

  /** Admin: PATCH body — faqat yuborilgan tier kalitlari yangilanadi. */
  async getXpTierBonusesAdminSettings() {
    return { tiers: await this.buildXpTiersPublicPayload() };
  }

  async patchXpTierBonusesForAdmin(tierBonusesUzs: Record<string, unknown>) {
    const current = await this.loadDriverXpTierBonusesUzsMap();
    const next = { ...current };
    const inObj = tierBonusesUzs ?? {};
    for (const t of XP_TIER_DEFINITIONS) {
      if (!Object.prototype.hasOwnProperty.call(inObj, t.id)) continue;
      const raw = inObj[t.id];
      let n = 0;
      if (typeof raw === "number" && Number.isFinite(raw)) n = Math.trunc(raw);
      else if (typeof raw === "string" && raw.trim().length)
        n = Math.trunc(Number(raw.replace(/\s/g, "").replace(/,/g, "")) || 0);
      next[t.id] = Math.max(0, Math.min(100_000_000, n));
    }
    await this.prisma.platformSettings.upsert({
      where: { id: "default" },
      create: { id: "default", driverXpTierBonusesUzsJson: next },
      update: { driverXpTierBonusesUzsJson: next },
    });
    return { tiers: await this.buildXpTiersPublicPayload() };
  }

  private async fetchLifetimeXpOverride(driverId: string) {
    try {
      return await this.prisma.driverLifetimeXpOverride.findUnique({
        where: { driverId },
        select: { xp: true, baseComputedXp: true },
      });
    } catch {
      return null;
    }
  }

  async resolveEffectiveLifetimeXp(driverId: string): Promise<{
    realComputedXp: number;
    effectiveXp: number;
    override: { xp: number; baseComputedXp: number | null } | null;
  }> {
    const xpStats = await this.computeLifetimeXp(driverId);
    const realComputedXp = xpStats.xp;
    const override = await this.fetchLifetimeXpOverride(driverId);
    const effectiveXp = applyLifetimeXpOverrideReactive({
      realComputedXp,
      override,
    });
    return { realComputedXp, effectiveXp, override };
  }

  async upsertDriverLifetimeXpOverride(params: {
    driverId: string;
    targetXp: number;
    updatedByUserId?: string | null;
  }) {
    const real = (await this.computeLifetimeXp(params.driverId)).xp;
    const xp = Math.max(0, Math.trunc(params.targetXp));
    await this.prisma.driverLifetimeXpOverride.upsert({
      where: { driverId: params.driverId },
      create: {
        driverId: params.driverId,
        xp,
        baseComputedXp: real,
        updatedByUserId: params.updatedByUserId ?? undefined,
      },
      update: {
        xp,
        baseComputedXp: real,
        updatedByUserId: params.updatedByUserId ?? undefined,
      },
    });
  }

  async deleteDriverLifetimeXpOverride(driverId: string) {
    try {
      await this.prisma.driverLifetimeXpOverride.delete({
        where: { driverId },
      });
    } catch {
      // ignore
    }
  }

  /** Admin: zona bo‘yicha haydovchilar XP (qidiruv + sahifa, global saralash). */
  async getAdminZoneXpLeaderboardPage(
    zoneId: string,
    pageRaw: number,
    limitRaw: number,
    search?: string,
  ) {
    const page = Math.max(1, Math.floor(pageRaw) || 1);
    const limit = Math.min(50, Math.max(1, Math.floor(limitRaw) || 20));
    const q = (search ?? "").trim().toLowerCase();
    const digits = q.replace(/\D/g, "");

    type AggRow = {
      id: string;
      trips: bigint | number | null;
      trip_minutes: number | null;
      pings: bigint | number | null;
    };
    const agg = await this.prisma.$queryRaw<AggRow[]>`
      WITH zd AS (
        SELECT d.id
        FROM "Driver" d
        WHERE d."serviceZoneId" = ${zoneId}::uuid
      ),
      trip_stats AS (
        SELECT t."driverId" AS id,
          COUNT(*) FILTER (WHERE t.status = ${TripStatus.COMPLETED}::"TripStatus")::int AS trips,
          COALESCE(SUM(EXTRACT(EPOCH FROM (t."endedAt" - t."startedAt"))) / 60.0, 0) AS trip_minutes
        FROM "Trip" t
        WHERE t."driverId" IN (SELECT id FROM zd)
        GROUP BY t."driverId"
      ),
      ping_stats AS (
        SELECT lp."driverId" AS id, COUNT(*)::int AS pings
        FROM "LocationPing" lp
        WHERE lp."driverId" IN (SELECT id FROM zd)
        GROUP BY lp."driverId"
      )
      SELECT zd.id,
        COALESCE(ts.trips, 0) AS trips,
        COALESCE(ts.trip_minutes, 0) AS trip_minutes,
        COALESCE(ps.pings, 0) AS pings
      FROM zd
      LEFT JOIN trip_stats ts ON ts.id = zd.id
      LEFT JOIN ping_stats ps ON ps.id = zd.id
    `;

    const xpFromAgg = (r: AggRow) => {
      const trips = Number(r.trips ?? 0);
      const tripMinutes = Math.max(0, Math.round(Number(r.trip_minutes ?? 0)));
      const pings = Number(r.pings ?? 0);
      const onlineMinutesProxy = Math.max(0, Math.round(pings * 2));
      return (
        trips * 10 + tripMinutes * 1 + Math.round(onlineMinutesProxy * 0.2)
      );
    };

    let ovAll: {
      driverId: string;
      xp: number;
      baseComputedXp: number | null;
    }[] = [];
    try {
      ovAll = await this.prisma.driverLifetimeXpOverride.findMany({
        where: { driverId: { in: agg.map((a) => a.id) } },
        select: { driverId: true, xp: true, baseComputedXp: true },
      });
    } catch {
      ovAll = [];
    }
    const ovMap = new Map(
      ovAll.map((o) => [
        o.driverId,
        { xp: o.xp, baseComputedXp: o.baseComputedXp },
      ]),
    );

    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: agg.map((a) => a.id) } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        user: { select: { phone: true } },
      },
    });
    const dMap = new Map(drivers.map((d) => [d.id, d]));

    type XpRow = {
      driverId: string;
      displayName: string;
      phone: string;
      firstName: string | null;
      lastName: string | null;
      lifetimeXpReal: number;
      lifetimeXpEffective: number;
      tier: string;
      tierLabelUz: string;
    };
    const combined: XpRow[] = [];
    for (const row of agg) {
      const d = dMap.get(row.id);
      if (!d) continue;
      const real = xpFromAgg(row);
      const ov = ovMap.get(row.id) ?? null;
      const effective = applyLifetimeXpOverrideReactive({
        realComputedXp: real,
        override: ov,
      });
      const lvl = this.computeLevel(effective);
      const displayName = this.displayName(d);
      const phone = d.user?.phone ?? "";
      combined.push({
        driverId: row.id,
        displayName,
        phone,
        firstName: d.firstName,
        lastName: d.lastName,
        lifetimeXpReal: real,
        lifetimeXpEffective: effective,
        tier: lvl.tier,
        tierLabelUz: lvl.labelUz,
      });
    }

    let filtered = combined;
    if (q.length > 0) {
      filtered = combined.filter((r) => {
        const name = `${r.displayName}`.toLowerCase();
        const ph = r.phone.toLowerCase().replace(/\D/g, "");
        return (
          name.includes(q) ||
          (digits.length > 0 && ph.includes(digits)) ||
          (r.firstName ?? "").toLowerCase().includes(q) ||
          (r.lastName ?? "").toLowerCase().includes(q)
        );
      });
    }

    filtered.sort((a, b) => {
      if (b.lifetimeXpEffective !== a.lifetimeXpEffective)
        return b.lifetimeXpEffective - a.lifetimeXpEffective;
      return a.displayName.localeCompare(b.displayName, "uz");
    });

    const total = filtered.length;
    const slice = filtered.slice(
      (page - 1) * limit,
      (page - 1) * limit + limit,
    );
    const rows = slice.map((r, i) => ({
      rank: (page - 1) * limit + i + 1,
      ...r,
    }));

    return {
      zoneId,
      page,
      limit,
      total,
      hasMore: page * limit < total,
      rows,
    };
  }

  async getChampionsSnapshot(driverId: string, periodYm?: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        ratingAvg: true,
        serviceZoneId: true,
        serviceZone: { select: { id: true, name: true, slug: true } },
        user: { select: { phone: true } },
      },
    });
    if (!driver) {
      throw new NotFoundException("Driver not found");
    }

    const zoneId = driver.serviceZoneId;
    const now = new Date();
    const overrideYm = await this.championsYmOverride();
    const win = monthWindowFromYmUtc(periodYm?.trim() ? periodYm : overrideYm);
    const monthStart = win.from;
    const monthEnd = win.to;
    const calendarYm = ymUtc(now);
    const periodMonthIsOverride = win.ym !== calendarYm;

    const [xpResolved, xpTiersPayload] = await Promise.all([
      this.resolveEffectiveLifetimeXp(driverId),
      this.buildXpTiersPublicPayload(),
    ]);
    const lifetimeXp = xpResolved.effectiveXp;
    const level = this.computeLevel(lifetimeXp);
    const xpBonusUzs =
      xpTiersPayload.find((x) => x.id === level.tier)?.bonusUzs ?? 0;

    if (!zoneId) {
      return {
        zone: null,
        needsZone: true,
        myDisplayName: this.displayName(driver),
        myMonthlyScore: 0,
        monthlyLeaderboardTotal: 0,
        periodYm: win.ym,
        periodMonthIsOverride,
        periodMonth: {
          startsAt: monthStart.toISOString(),
          endsAt: monthEnd.toISOString(),
          labelUz: `Oy · ${win.ym}`,
        },
        monthlyLeaderboard: [],
        myMonthlyRank: null,
        monthlyTrips: 0,
        lifetimeXp,
        lifetimeXpReal: xpResolved.realComputedXp,
        xpBonusUzs,
        xpTiers: [...xpTiersPayload],
        level,
        badges: [],
        season: await this.seasonPayload(now),
      };
    }

    const [monthlyBoardFull, myMonthTripsRaw, myMonthCancels] =
      await Promise.all([
        this.buildLeaderboardOrdered(zoneId, monthStart, monthEnd),
        this.prisma.trip.count({
          where: {
            driverId,
            status: TripStatus.COMPLETED,
            endedAt: { gte: monthStart, lt: monthEnd },
          },
        }),
        this.countDriverCancels(driverId, monthStart, monthEnd),
      ]);

    const mi = monthlyBoardFull.findIndex((r) => r.driverId === driverId);
    const rankMonth = mi === -1 ? null : mi + 1;

    const periodYmKey = ymUtc(monthStart);
    const myOverride = await (async () => {
      try {
        return await this.prisma.driverLeaderboardOverride.findUnique({
          where: { driverId_periodYm: { driverId, periodYm: periodYmKey } },
          select: {
            score: true,
            trips: true,
            baseTrips: true,
            baseCancels: true,
          },
        });
      } catch {
        return null;
      }
    })();

    const myComputed = myOverride
      ? applyOverrideReactive({
          realTrips: myMonthTripsRaw,
          realCancels: myMonthCancels,
          override: myOverride,
        })
      : {
          trips: myMonthTripsRaw,
          score: scoreFromStats(myMonthTripsRaw, myMonthCancels),
        };
    const myMonthTrips = myComputed.trips;
    const myMonthlyScoreVal = myComputed.score;

    const monthlyPreview = monthlyBoardFull.slice(0, MONTHLY_PREVIEW_TOP);

    return {
      needsZone: false,
      myDisplayName: this.displayName(driver),
      myMonthlyScore: myMonthlyScoreVal,
      monthlyLeaderboardTotal: monthlyBoardFull.length,
      periodYm: win.ym,
      periodMonthIsOverride,
      zone: driver.serviceZone
        ? {
            id: driver.serviceZone.id,
            name: driver.serviceZone.name,
            slug: driver.serviceZone.slug,
          }
        : null,
      periodMonth: {
        startsAt: monthStart.toISOString(),
        endsAt: monthEnd.toISOString(),
        labelUz: `Oy · ${win.ym}`,
      },
      monthlyLeaderboard: monthlyPreview.map((r, i) => ({
        rank: i + 1,
        driverId: r.driverId,
        displayName: r.displayName,
        trips: r.trips,
        score: r.score,
        ratingAvg: r.ratingAvg,
        isMe: r.driverId === driverId,
      })),
      myMonthlyRank: rankMonth,
      monthlyTrips: myMonthTrips,
      myScores: {
        monthly: myMonthlyScoreVal,
      },
      lifetimeXp,
      lifetimeXpReal: xpResolved.realComputedXp,
      xpBonusUzs,
      xpTiers: [...xpTiersPayload],
      level,
      badges: [],
      season: await this.seasonPayload(now),
    };
  }

  /** Haydovchi: oylik to‘liq ro‘yxatdan sahifa (offset/limit). */
  async getMonthlyLeaderboardPage(
    driverId: string,
    offsetRaw: number,
    limitRaw: number,
  ) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        serviceZoneId: true,
      },
    });
    if (!driver) {
      throw new NotFoundException("Driver not found");
    }
    const zoneId = driver.serviceZoneId;
    if (!zoneId) {
      return {
        offset: 0,
        limit: Math.min(50, Math.max(1, limitRaw || 10)),
        total: 0,
        hasMore: false,
        items: [],
      };
    }
    const overrideYm = await this.championsYmOverride();
    const win = monthWindowFromYmUtc(overrideYm);
    const monthStart = win.from;
    const monthEnd = win.to;
    const offset = Math.max(0, Math.floor(offsetRaw) || 0);
    const limit = Math.min(50, Math.max(1, Math.floor(limitRaw) || 10));

    const full = await this.buildLeaderboardOrdered(
      zoneId,
      monthStart,
      monthEnd,
    );
    const slice = full.slice(offset, offset + limit);
    const items = slice.map((r, i) => ({
      rank: offset + i + 1,
      driverId: r.driverId,
      displayName: r.displayName,
      trips: r.trips,
      score: r.score,
      ratingAvg: r.ratingAvg,
      isMe: r.driverId === driverId,
    }));

    return {
      offset,
      limit,
      total: full.length,
      hasMore: offset + limit < full.length,
      items,
    };
  }

  /** Admin: zona + davr bo‘yicha batafsil leaderboard (telefon, bekorlar). */
  async getAdminZoneLeaderboard(zoneId: string, period: "week" | "month") {
    // Back-compat: return full list by using the paged method with a high cap
    const page = await this.getAdminZoneLeaderboardPage(
      zoneId,
      period,
      1,
      400,
      undefined,
    );
    return {
      zone: page.zone,
      period: page.period,
      window: page.window,
      rows: page.rows,
    };
  }

  /** Admin: paged leaderboard (server-side) — 20tadan; qidiruv name/phone. */
  async getAdminZoneLeaderboardPage(
    zoneId: string,
    period: "week" | "month",
    pageRaw: number,
    limitRaw: number,
    searchRaw?: string,
  ) {
    const zone = await this.prisma.serviceZone.findUnique({
      where: { id: zoneId },
      select: { id: true, name: true, slug: true },
    });
    if (!zone) {
      throw new NotFoundException("Zone not found");
    }
    const now = new Date();
    const overrideYm = await this.championsYmOverride();
    const win = period === "month" ? monthWindowFromYmUtc(overrideYm) : null;
    const from = period === "week" ? startOfIsoWeekUtc(now) : win!.from;
    const to = period === "week" ? endOfIsoWeekUtc(now) : win!.to;
    const page = Math.max(1, Math.floor(pageRaw) || 1);
    const limit = Math.min(100, Math.max(1, Math.floor(limitRaw) || 20));
    const offset = (page - 1) * limit;
    const search = (searchRaw ?? "").trim().toLowerCase();
    const searchDigits = search.replace(/\D/g, "");
    const isMonth = period === "month";
    const ym = ymUtc(from);

    const tripsGrouped = await this.prisma.trip.groupBy({
      by: ["driverId"],
      where: {
        status: TripStatus.COMPLETED,
        endedAt: { gte: from, lt: to },
        driver: { serviceZoneId: zoneId },
      },
      _count: { id: true },
    });

    const withTrips = tripsGrouped.filter((g) => g._count.id > 0);
    if (withTrips.length === 0) {
      return {
        zone,
        period,
        window: { startsAt: from.toISOString(), endsAt: to.toISOString() },
        page,
        limit,
        total: 0,
        hasMore: false,
        rows: [],
      };
    }

    const driverIds = withTrips.map((g) => g.driverId);

    const cancelsGrouped = await this.prisma.order.groupBy({
      by: ["assignedDriverId"],
      where: {
        assignedDriverId: { in: driverIds },
        status: OrderStatus.CANCELLED_BY_DRIVER,
        updatedAt: { gte: from, lt: to },
      },
      _count: { id: true },
    });
    const cancelsMap = new Map<string, number>();
    for (const c of cancelsGrouped) {
      if (c.assignedDriverId) cancelsMap.set(c.assignedDriverId, c._count.id);
    }

    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: driverIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        ratingAvg: true,
        user: { select: { phone: true } },
      },
    });
    const driverById = new Map(drivers.map((d) => [d.id, d]));

    const overrides = await (async () => {
      if (!isMonth) return [];
      try {
        return await this.prisma.driverLeaderboardOverride.findMany({
          where: { periodYm: ym, driverId: { in: driverIds } },
          select: {
            driverId: true,
            score: true,
            trips: true,
            baseTrips: true,
            baseCancels: true,
          },
        });
      } catch {
        return [];
      }
    })();
    const overrideById = new Map(overrides.map((o) => [o.driverId, o]));

    const rowsAll = withTrips
      .map((g) => {
        const d = driverById.get(g.driverId);
        if (!d) return null;
        const phone = d.user.phone;
        const displayName = this.displayName(d);
        const cancels = cancelsMap.get(g.driverId) ?? 0;
        const ov = overrideById.get(g.driverId);
        const realTrips = g._count.id;
        const computed = ov
          ? applyOverrideReactive({
              realTrips,
              realCancels: cancels,
              override: ov,
            })
          : { trips: realTrips, score: scoreFromStats(realTrips, cancels) };
        const trips = computed.trips;
        const score = computed.score;
        const ratingAvg = d.ratingAvg != null ? Number(d.ratingAvg) : null;
        return {
          driverId: g.driverId,
          displayName,
          phone,
          firstName: d.firstName,
          lastName: d.lastName,
          trips,
          score,
          ratingAvg,
          driverCancelsInPeriod: cancels,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    const rowsFiltered = search.length
      ? rowsAll.filter((r) => {
          const phone = r.phone.toLowerCase();
          const name = r.displayName.toLowerCase();
          if (phone.includes(search) || name.includes(search)) return true;
          if (searchDigits.length) {
            const digits = r.phone.replace(/\D/g, "");
            return digits.includes(searchDigits);
          }
          return false;
        })
      : rowsAll;

    rowsFiltered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.trips !== a.trips) return b.trips - a.trips;
      return (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0);
    });

    const total = rowsFiltered.length;
    const pageSlice = rowsFiltered.slice(offset, offset + limit);
    return {
      zone,
      period,
      window: { startsAt: from.toISOString(), endsAt: to.toISOString() },
      page,
      limit,
      total,
      hasMore: offset + limit < total,
      rows: pageSlice.map((r, idx) => ({
        rank: offset + idx + 1,
        driverId: r.driverId,
        displayName: r.displayName,
        phone: r.phone,
        firstName: r.firstName,
        lastName: r.lastName,
        trips: r.trips,
        score: r.score,
        ratingAvg: r.ratingAvg,
        driverCancelsInPeriod: r.driverCancelsInPeriod,
      })),
    };
  }

  private async seasonPayload(now: Date) {
    const ends = endOfQuarterUtc(now);
    const dateStr = ends.toISOString().slice(0, 10);
    const settings = await this.prisma.platformSettings.findUnique({
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
    const defaultPrizeHint =
      "Har chorak oxirida zonangiz bo‘yicha eng yuqori natija ko‘rsatgan haydovchilar orasidan tanlov — sovrin fondi $100 (platforma qoidalariga muvofiq).";
    const defaultCadence =
      "Chempionlar oylik jadvali kalendarya oy bo‘yicha; yangi oyda hisoblar yangilanadi.";
    const tpl = settings?.championsPeriodEndTemplateUz?.trim();
    const periodEndLabelUz =
      tpl && tpl.length > 0
        ? tpl.replace(/\{\{DATE\}\}/g, dateStr).replace(/\{date\}/gi, dateStr)
        : `Chorak tugashi (taxmin): ${dateStr}`;
    const bannerPaths = parseBannerPathsJson(settings?.championsHomeBannerPathsJson);
    const intervalRaw = settings?.championsHomeCarouselIntervalSec ?? 5;
    const intervalSec = Math.min(60, Math.max(3, Math.trunc(Number(intervalRaw)) || 5));
    return {
      titleUz: (
        settings?.championsSeasonTitleUz?.trim() || "Choraklik sovrin"
      ).trim(),
      quarterEndsAt: ends.toISOString(),
      prizeUsd: settings?.championsPrizeUsd ?? 100,
      prizeHintUz: (
        settings?.championsPrizeDescriptionUz?.trim() || defaultPrizeHint
      ).trim(),
      cadenceHintUz: (
        settings?.championsCadenceHintUz?.trim() || defaultCadence
      ).trim(),
      periodEndLabelUz,
      homeCarousel: {
        intervalSec,
        imageUrls: bannerPathsToPublicUrls(bannerPaths),
      },
    };
  }

  private computeLevel(xp: number) {
    const tiers = XP_TIER_DEFINITIONS;
    let idx = 0;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (xp >= tiers[i].minXp) {
        idx = i;
        break;
      }
    }
    const current = tiers[idx];
    const nextTierXp = tiers[idx + 1]?.minXp ?? null;
    let progressPct = 100;
    if (nextTierXp != null) {
      const span = nextTierXp - current.minXp;
      const within = xp - current.minXp;
      progressPct = Math.min(
        100,
        Math.max(0, Math.round(span > 0 ? (within / span) * 100 : 0)),
      );
    }
    return {
      tier: current.id,
      labelUz: current.labelUz,
      minXp: current.minXp,
      nextTierXp,
      progressPct,
      totalXp: xp,
    };
  }

  /**
   * XP business-logic (rating-siz):
   * - har completed safar: +10 XP
   * - har safar minuti: +1 XP
   * - onlayn vaqti proxy: LocationPing soni * 2 minut (ping odatda ~2 daqiqada bir)
   *   va har onlayn proxy minuti: +0.2 XP
   *
   * Eslatma: onlayn session tarixi yo‘q, shuning uchun pinglar proxy bo‘lib xizmat qiladi.
   */
  private async computeLifetimeXp(driverId: string): Promise<XpStats> {
    const [trips, pingCount, tripMinutesRow] = await Promise.all([
      this.prisma.trip.count({
        where: { driverId, status: TripStatus.COMPLETED },
      }),
      this.prisma.locationPing.count({
        where: { driverId },
      }),
      this.prisma.$queryRaw<{ minutes: number | null }[]>(
        Prisma.sql`
          SELECT
            COALESCE(
              SUM(EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))),
              0
            ) / 60.0 AS minutes
          FROM "Trip"
          WHERE "driverId" = ${driverId}::uuid
            AND status = ${TripStatus.COMPLETED}::"TripStatus"
            AND "startedAt" IS NOT NULL
            AND "endedAt" IS NOT NULL
        `,
      ),
    ]);

    const tripMinutes = Math.max(
      0,
      Math.round(Number(tripMinutesRow?.[0]?.minutes ?? 0)),
    );
    const onlineMinutesProxy = Math.max(0, Math.round(pingCount * 2));
    const xp =
      trips * 10 + tripMinutes * 1 + Math.round(onlineMinutesProxy * 0.2);

    return { trips, tripMinutes, onlineMinutesProxy, xp };
  }

  private async countDriverCancels(
    driverId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.order.count({
      where: {
        assignedDriverId: driverId,
        status: OrderStatus.CANCELLED_BY_DRIVER,
        updatedAt: { gte: from, lt: to },
      },
    });
  }

  private async buildLeaderboardOrdered(
    zoneId: string,
    from: Date,
    to: Date,
  ): Promise<(RowAgg & { score: number })[]> {
    const grouped = await this.prisma.trip.groupBy({
      by: ["driverId"],
      where: {
        status: TripStatus.COMPLETED,
        endedAt: { gte: from, lt: to },
        driver: { serviceZoneId: zoneId },
      },
      _count: { id: true },
    });

    const withTrips = grouped.filter((g) => g._count.id > 0);
    if (withTrips.length === 0) return [];

    const driverIds = withTrips.map((g) => g.driverId);
    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: driverIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        ratingAvg: true,
        user: { select: { phone: true } },
      },
    });
    const byId = new Map(drivers.map((d) => [d.id, d]));

    const cancelCounts = await Promise.all(
      driverIds.map(async (did) => ({
        did,
        n: await this.countDriverCancels(did, from, to),
      })),
    );
    const cancelMap = new Map(cancelCounts.map((c) => [c.did, c.n]));

    const periodYm = ymUtc(from);
    const overrides = await (async () => {
      try {
        return await this.prisma.driverLeaderboardOverride.findMany({
          where: {
            periodYm,
            driver: { serviceZoneId: zoneId },
          },
          select: {
            driverId: true,
            score: true,
            trips: true,
            baseTrips: true,
            baseCancels: true,
          },
        });
      } catch {
        // Safety: if migration hasn't run yet, ignore overrides.
        return [];
      }
    })();
    const overrideById = new Map<
      string,
      {
        driverId: string;
        score: number;
        trips: number;
        baseTrips?: number | null;
        baseCancels?: number | null;
      }
    >(overrides.map((o) => [o.driverId, o]));

    const rows: (RowAgg & { score: number })[] = [];
    for (const g of withTrips) {
      const d = byId.get(g.driverId);
      if (!d) continue;
      const cancels = cancelMap.get(g.driverId) ?? 0;
      const ratingAvg = d.ratingAvg != null ? Number(d.ratingAvg) : null;
      const ov = overrideById.get(g.driverId);
      const realTrips = g._count.id;
      const computed = ov
        ? applyOverrideReactive({
            realTrips,
            realCancels: cancels,
            override: ov,
          })
        : { trips: realTrips, score: scoreFromStats(realTrips, cancels) };
      const trips = computed.trips;
      const score = computed.score;
      rows.push({
        driverId: g.driverId,
        trips,
        ratingAvg,
        displayName: this.displayName(d),
        score,
      });
    }

    rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.trips !== a.trips) return b.trips - a.trips;
      return (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0);
    });

    return rows;
  }

  private displayName(d: {
    firstName: string | null;
    lastName: string | null;
    user: { phone: string };
  }): string {
    const fn = d.firstName?.trim();
    const ln = d.lastName?.trim();
    if (fn || ln) {
      const bit = ln ? `${ln.charAt(0)}.` : "";
      return [fn, bit].filter(Boolean).join(" ");
    }
    const p = d.user.phone;
    const tail = p.length >= 4 ? p.slice(-4) : p;
    return `Haydovchi ***${tail}`;
  }
}
