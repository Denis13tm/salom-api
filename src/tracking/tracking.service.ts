import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IngestPingsBodyDto, LocationPingInDto } from './dto/ingest-pings.dto';
import { LastKnownStore, LastDriverLocation } from './last-known.store';
import { isPingQualityOk, isPlausibleStep } from './location-quality';
import { OperatorGateway } from './operator.gateway';

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly lastKnown: LastKnownStore,
    private readonly operatorGateway: OperatorGateway,
  ) {}

  assertSnapshotAccess(headers: Record<string, string | string[] | undefined>) {
    const key = this.config.get<string | undefined>('TRACKING_SNAPSHOT_KEY');
    const env = this.config.get<string>('NODE_ENV');
    if (key) {
      const h = headers['x-snapshot-key'];
      const v = Array.isArray(h) ? h[0] : h;
      if (v !== key) throw new ForbiddenException();
      return;
    }
    if (env === 'production') {
      throw new ForbiddenException('TRACKING_SNAPSHOT_KEY is not set');
    }
  }

  getZoneSnapshot(serviceZoneId: string) {
    return { serviceZoneId, drivers: this.lastKnown.getZoneSnapshot(serviceZoneId) };
  }

  /** Operator panel: zonal haydovchilar + so‘nggi GPS (mavjud bo‘lsa). */
  async listDriversRosterForZone(serviceZoneId: string) {
    const zone = await this.prisma.serviceZone.findUnique({
      where: { id: serviceZoneId },
      select: { id: true },
    });
    if (!zone) {
      throw new NotFoundException('Zona topilmadi');
    }
    const drivers = await this.prisma.driver.findMany({
      where: { serviceZoneId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        operationalStatus: true,
        onboardingStatus: true,
        user: { select: { phone: true, status: true } },
      },
      take: 400,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    });
    const snaps = this.lastKnown.getZoneSnapshot(serviceZoneId);
    const byMem = new Map(snaps.map((s) => [s.driverId, s]));

    const driverIds = drivers.map((d) => d.id);
    type LatestPingSqlRow = {
      driverId: string;
      lat: Prisma.Decimal;
      lng: Prisma.Decimal;
      recordedAt: Date;
      accuracyM: number | null;
      speedKmh: number | null;
    };

    /** Prisma distinct + sort “har haydovchi uchun so‘nggi ping” uchun ishonchsiz → PG DISTINCT ON. */
    const dbLatest =
      driverIds.length === 0
        ? ([] as LatestPingSqlRow[])
        : await this.prisma.$queryRaw<LatestPingSqlRow[]>(
            Prisma.sql`
              SELECT DISTINCT ON ("driverId")
                "driverId",
                lat,
                lng,
                "recordedAt",
                "accuracyM",
                "speedKmh"
              FROM "LocationPing"
              WHERE "driverId" IN (${Prisma.join(
                driverIds.map((id) => Prisma.sql`${id}::uuid`),
              )})
              ORDER BY "driverId", "recordedAt" DESC
            `,
          );

    const byDb = new Map(
      dbLatest.map((p) => [
        p.driverId,
        {
          lat: Number(p.lat),
          lng: Number(p.lng),
          recordedAt: p.recordedAt.toISOString(),
          accuracyM: p.accuracyM ?? undefined,
          speedKmh: p.speedKmh ?? undefined,
        },
      ]),
    );

    return {
      serviceZoneId,
      items: drivers.map((d) => {
        const mem = byMem.get(d.id);
        const db = byDb.get(d.id);
        const lk = mem
          ? {
              lat: mem.lat,
              lng: mem.lng,
              recordedAt: mem.recordedAt,
              accuracyM: mem.accuracyM,
              speedKmh: mem.speedKmh,
            }
          : db ?? null;
        return {
          id: d.id,
          firstName: d.firstName,
          lastName: d.lastName,
          phone: d.user.phone,
          userStatus: d.user.status,
          operationalStatus: d.operationalStatus,
          onboardingStatus: d.onboardingStatus,
          lastKnown: lk,
        };
      }),
    };
  }

  async ingestPings(driverId: string, body: IngestPingsBodyDto) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, serviceZoneId: true },
    });
    if (!driver) throw new NotFoundException('Driver not found');

    const maxAge = this.config.get<number>('TRACKING_MAX_PING_AGE_MINUTES', 2);
    const maxAccuracyM = this.config.get<number>('TRACKING_MAX_ACCURACY_M', 2000);
    const sorted = [...body.pings].sort((a, b) => {
      const ta = new Date(a.recordedAt ?? 0).getTime() || 0;
      const tb = new Date(b.recordedAt ?? 0).getTime() || 0;
      return ta - tb;
    });

    const skipSample: { reason: string }[] = [];
    let lastKnownForPlaus = this.lastKnown.getOne(driverId);
    const accepted: LocationPingInDto[] = [];

    for (const p of sorted) {
      const recordedAtStr = p.recordedAt ?? new Date().toISOString();
      const q = isPingQualityOk(
        { ...p, recordedAt: recordedAtStr },
        { maxAgeMinutes: maxAge, maxAccuracyM },
      );
      if (!q.ok) {
        if (skipSample.length < 5) skipSample.push({ reason: q.reason.code });
        continue;
      }
      const t = new Date(recordedAtStr).getTime();
      const prev = lastKnownForPlaus
        ? {
            lat: lastKnownForPlaus.lat,
            lng: lastKnownForPlaus.lng,
            t: new Date(lastKnownForPlaus.recordedAt).getTime(),
          }
        : null;
      if (!isPlausibleStep(prev, { lat: p.lat, lng: p.lng, t })) {
        if (skipSample.length < 5) skipSample.push({ reason: 'implausible_step' });
        continue;
      }
      accepted.push({ ...p, recordedAt: recordedAtStr });
      lastKnownForPlaus = {
        driverId,
        serviceZoneId: driver.serviceZoneId,
        lat: p.lat,
        lng: p.lng,
        recordedAt: recordedAtStr,
        accuracyM: p.accuracyM,
        speedKmh: p.speedKmh,
      };
    }

    if (accepted.length === 0) {
      return { accepted: 0, skipped: body.pings.length, skipSample };
    }

    const data: Prisma.LocationPingCreateManyInput[] = accepted.map((p) => ({
      driverId,
      orderId: p.orderId ?? undefined,
      tripId: p.tripId ?? undefined,
      lat: new Prisma.Decimal(p.lat),
      lng: new Prisma.Decimal(p.lng),
      accuracyM: p.accuracyM,
      speedKmh: p.speedKmh,
      recordedAt: new Date(p.recordedAt!),
      source: p.source ?? 'gps',
    }));

    await this.prisma.locationPing.createMany({ data });

    const last = accepted[accepted.length - 1]!;
    const snap: LastDriverLocation = {
      driverId,
      serviceZoneId: driver.serviceZoneId,
      lat: last.lat,
      lng: last.lng,
      recordedAt: last.recordedAt!,
      accuracyM: last.accuracyM,
      speedKmh: last.speedKmh,
    };
    this.lastKnown.set(snap);
    this.operatorGateway.emitDriverLocation(snap);

    return {
      accepted: accepted.length,
      skipped: body.pings.length - accepted.length,
      skipSample: skipSample.length ? skipSample : undefined,
    };
  }
}
