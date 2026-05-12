import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { distanceMetersHaversine } from '../common/haversine';
import { PrismaService } from '../prisma/prisma.service';

type PricingInput = {
  serviceZoneId: string;
  pickupLat?: number;
  pickupLng?: number;
  pricingRingId?: string;
};

@Injectable()
export class PricingEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async defaultProfileForZone(serviceZoneId: string) {
    const existing = await this.prisma.pricingProfile.findFirst({
      where: { serviceZoneId, isActive: true, isDefault: true },
      orderBy: { updatedAt: 'desc' },
      include: { rings: { orderBy: { sortOrder: 'asc' } }, serviceZone: true },
    });
    if (existing) return existing;

    const zone = await this.prisma.serviceZone.findUnique({ where: { id: serviceZoneId } });
    if (!zone) throw new NotFoundException('Service zone not found');

    return this.prisma.pricingProfile.create({
      data: {
        serviceZoneId,
        name: `${zone.name} default`,
        cityKmRateUzs: new Prisma.Decimal(2500),
        outsideKmRateUzs: new Prisma.Decimal(3500),
        freeWaitMinutes: zone.waitingFreeMinutes ?? 10,
        waitPerMinuteUzs: zone.waitingFeePerMinuteUzs ?? new Prisma.Decimal(1000),
        rings: {
          create: [
            {
              code: 'city',
              name: 'Shahar ichi',
              radiusFromKm: new Prisma.Decimal(0),
              radiusToKm: new Prisma.Decimal(5),
              starterFeeUzs: zone.starterFeeUzs ?? zone.meterBaseUzs ?? new Prisma.Decimal(6000),
              distanceRateUzs: new Prisma.Decimal(2500),
              sortOrder: 10,
            },
            {
              code: 'edge',
              name: 'Shahar chekasi',
              radiusFromKm: new Prisma.Decimal(5),
              radiusToKm: new Prisma.Decimal(8),
              starterFeeUzs: new Prisma.Decimal(7000),
              distanceRateUzs: new Prisma.Decimal(2500),
              sortOrder: 20,
            },
            {
              code: 'outer_1',
              name: 'Shahar tashqarisi 1',
              radiusFromKm: new Prisma.Decimal(8),
              radiusToKm: new Prisma.Decimal(15),
              starterFeeUzs: new Prisma.Decimal(10000),
              distanceRateUzs: new Prisma.Decimal(3500),
              sortOrder: 30,
            },
            {
              code: 'outer_2',
              name: 'Shahar tashqarisi 2',
              radiusFromKm: new Prisma.Decimal(15),
              radiusToKm: new Prisma.Decimal(25),
              starterFeeUzs: new Prisma.Decimal(15000),
              distanceRateUzs: new Prisma.Decimal(3500),
              sortOrder: 40,
            },
            {
              code: 'special',
              name: '25 km+ / maxsus',
              radiusFromKm: new Prisma.Decimal(25),
              starterFeeUzs: new Prisma.Decimal(20000),
              distanceRateUzs: new Prisma.Decimal(3500),
              sortOrder: 50,
            },
          ],
        },
      },
      include: { rings: { orderBy: { sortOrder: 'asc' } }, serviceZone: true },
    });
  }

  async snapshotForOrder(input: PricingInput) {
    const profile = await this.defaultProfileForZone(input.serviceZoneId);
    const zone = profile.serviceZone;
    let distanceKm: number | null = null;
    let ring =
      input.pricingRingId != null
        ? profile.rings.find((r) => r.id === input.pricingRingId)
        : null;

    if (input.pickupLat != null && input.pickupLng != null && zone.centerLat != null && zone.centerLng != null) {
      distanceKm =
        distanceMetersHaversine(
          Number(zone.centerLat),
          Number(zone.centerLng),
          input.pickupLat,
          input.pickupLng,
        ) / 1000;
      ring =
        profile.rings.find((r) => {
          const from = Number(r.radiusFromKm);
          const to = r.radiusToKm == null ? Number.POSITIVE_INFINITY : Number(r.radiusToKm);
          return distanceKm! >= from && distanceKm! < to;
        }) ?? profile.rings.at(-1) ?? null;
    }

    ring ??= profile.rings[0] ?? null;
    if (!ring) throw new BadRequestException('Pricing ring not configured');

    const starterFeeUzs = Number(ring.starterFeeUzs);
    const defaultRate =
      ring.distanceRateUzs != null
        ? Number(ring.distanceRateUzs)
        : ring.code === 'city' || ring.code === 'edge'
          ? Number(profile.cityKmRateUzs)
          : Number(profile.outsideKmRateUzs);
    const distanceRateUzs = defaultRate;

    return {
      pricingProfileId: profile.id,
      pricingRingId: ring.id,
      pickupPricingZoneName: ring.name,
      pickupDistanceFromCenterKm: distanceKm == null ? null : new Prisma.Decimal(distanceKm.toFixed(2)),
      starterFeeUzs: new Prisma.Decimal(starterFeeUzs),
      distanceRateUzs: new Prisma.Decimal(distanceRateUzs),
      freeWaitMinutes: profile.freeWaitMinutes,
      waitingFeePerMinuteUzs: profile.waitPerMinuteUzs,
      pricingOverridden: false,
      pricingOverrideReason: null,
      ringCode: ring.code,
    };
  }
}
