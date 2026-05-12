import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { distanceMetersHaversine } from "../common/haversine";

export type MeterConfigSnapshot = {
  baseUzs: number;
  perKmUzs: number;
  minSegmentM: number;
  idleMaxImpliedKmh: number;
};

/**
 * METERED: base + (km × per km), masofa — GPS oraliqlar yig‘indisi;
 * kichik segment va past tezlik (tirbandlik / to‘xtash) qo‘shilmaydi.
 */
@Injectable()
export class FareMeterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  configSnapshot(): MeterConfigSnapshot {
    return {
      baseUzs: this.config.get<number>("METER_BASE_FARE_UZS", 5_000),
      perKmUzs: this.config.get<number>("METER_PER_KM_UZS", 5_000),
      minSegmentM: this.config.get<number>("METER_MIN_SEGMENT_M", 12),
      idleMaxImpliedKmh: this.config.get<number>(
        "METER_IDLE_MAX_IMPLIED_KMH",
        4,
      ),
    };
  }

  /** Zonada `meterPerKmUzs` / `meterBaseUzs` qisman yoki to‘liq berilsa env ustiga yoziladi. */
  async configSnapshotForServiceZoneId(
    serviceZoneId: string | null | undefined,
  ): Promise<MeterConfigSnapshot> {
    const base = this.configSnapshot();
    if (!serviceZoneId) {
      return base;
    }
    const z = await this.prisma.serviceZone.findUnique({
      where: { id: serviceZoneId },
      select: { meterBaseUzs: true, meterPerKmUzs: true },
    });
    if (!z?.meterPerKmUzs && !z?.meterBaseUzs) {
      return base;
    }
    return {
      ...base,
      baseUzs: z?.meterBaseUzs != null ? Number(z.meterBaseUzs) : base.baseUzs,
      perKmUzs:
        z?.meterPerKmUzs != null ? Number(z.meterPerKmUzs) : base.perKmUzs,
    };
  }

  /** Brutto yurilgan masofa: taxminiy tezlik (pinglar orasida) < chegara bo‘lgan segmentlar hisobga olinmaydi. */
  billableMetersFromPings(
    pings: {
      lat: number;
      lng: number;
      recordedAt: Date;
      speedKmh: number | null;
    }[],
    snap = this.configSnapshot(),
  ): number {
    const sorted = [...pings].sort(
      (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
    );
    if (sorted.length < 2) {
      return 0;
    }
    let total = 0;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const d = distanceMetersHaversine(a.lat, a.lng, b.lat, b.lng);
      if (d < snap.minSegmentM) {
        continue;
      }
      const dtSec = Math.max(
        0.5,
        (b.recordedAt.getTime() - a.recordedAt.getTime()) / 1000,
      );
      const impliedKmh = d / 1000 / (dtSec / 3600);
      if (impliedKmh < snap.idleMaxImpliedKmh) {
        continue;
      }
      total += d;
    }
    return total;
  }

  grossUzsForMeters(
    billableMeters: number,
    snap: Pick<MeterConfigSnapshot, "baseUzs" | "perKmUzs">,
  ): number {
    const km = Math.max(0, billableMeters) / 1000;
    return Math.round(snap.baseUzs + snap.perKmUzs * km);
  }

  /** Starter alohida hisoblangan model: faqat km × narx (boshlash narxi zonada). */
  distanceFeeUzsOnly(billableMeters: number, perKmUzs: number): number {
    const km = Math.max(0, billableMeters) / 1000;
    return Math.round(perKmUzs * km);
  }

  async computeDistanceFareOnlyForTrip(
    tripId: string,
    overridePerKmUzs?: number,
  ) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { order: { select: { serviceZoneId: true } } },
    });
    if (!trip) {
      throw new NotFoundException("Trip not found");
    }
    const pings = await this.prisma.locationPing.findMany({
      where: { tripId },
      orderBy: { recordedAt: "asc" },
      select: { lat: true, lng: true, recordedAt: true, speedKmh: true },
    });
    const parsed = pings.map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      recordedAt: p.recordedAt,
      speedKmh: p.speedKmh,
    }));
    const snap = await this.configSnapshotForServiceZoneId(
      trip.order?.serviceZoneId,
    );
    const billableMeters = this.billableMetersFromPings(parsed, snap);
    const perKmUzs = overridePerKmUzs ?? snap.perKmUzs;
    const distanceFeeUzs = this.distanceFeeUzsOnly(billableMeters, perKmUzs);
    return { billableMeters, distanceFeeUzs, perKmUzs };
  }

  async computeForTrip(tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { order: { select: { serviceZoneId: true } } },
    });
    if (!trip) {
      throw new NotFoundException("Trip not found");
    }
    const pings = await this.prisma.locationPing.findMany({
      where: { tripId },
      orderBy: { recordedAt: "asc" },
      select: { lat: true, lng: true, recordedAt: true, speedKmh: true },
    });
    const parsed = pings.map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      recordedAt: p.recordedAt,
      speedKmh: p.speedKmh,
    }));
    const snap = await this.configSnapshotForServiceZoneId(
      trip.order?.serviceZoneId,
    );
    const billableMeters = this.billableMetersFromPings(parsed, snap);
    const grossUzs = this.grossUzsForMeters(billableMeters, snap);
    return {
      billableMeters,
      grossUzs,
      baseUzs: snap.baseUzs,
      perKmUzs: snap.perKmUzs,
    };
  }

  async effectivePerKmUzs(
    serviceZoneId: string | null | undefined,
  ): Promise<number> {
    const s = await this.configSnapshotForServiceZoneId(serviceZoneId);
    return s.perKmUzs;
  }
}
