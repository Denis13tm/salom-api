import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Ro‘yxatdan o‘tish / ariza uchun faol xizmat zonalari (UUID tanlash). */
@Controller({ path: 'public/service-zones', version: '1' })
export class PublicServiceZonesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.serviceZone.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        centerLat: true,
        centerLng: true,
        starterFeeUzs: true,
        waitingFreeMinutes: true,
        waitingFeePerMinuteUzs: true,
        pricingProfiles: {
          where: { isActive: true, isDefault: true },
          take: 1,
          select: {
            id: true,
            name: true,
            cityKmRateUzs: true,
            outsideKmRateUzs: true,
            freeWaitMinutes: true,
            waitPerMinuteUzs: true,
            rings: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                code: true,
                name: true,
                radiusFromKm: true,
                radiusToKm: true,
                starterFeeUzs: true,
                distanceRateUzs: true,
                sortOrder: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((z) => ({
      id: z.id,
      name: z.name,
      slug: z.slug,
      centerLat: z.centerLat != null ? Number(z.centerLat) : null,
      centerLng: z.centerLng != null ? Number(z.centerLng) : null,
      starterFeeUzs: z.starterFeeUzs != null ? Number(z.starterFeeUzs) : null,
      waitingFreeMinutes: z.waitingFreeMinutes ?? null,
      waitingFeePerMinuteUzs: z.waitingFeePerMinuteUzs != null ? Number(z.waitingFeePerMinuteUzs) : null,
      pricingProfile: z.pricingProfiles[0]
        ? {
            id: z.pricingProfiles[0].id,
            name: z.pricingProfiles[0].name,
            cityKmRateUzs: Number(z.pricingProfiles[0].cityKmRateUzs),
            outsideKmRateUzs: Number(z.pricingProfiles[0].outsideKmRateUzs),
            freeWaitMinutes: z.pricingProfiles[0].freeWaitMinutes,
            waitPerMinuteUzs: Number(z.pricingProfiles[0].waitPerMinuteUzs),
            rings: z.pricingProfiles[0].rings.map((r) => ({
              id: r.id,
              code: r.code,
              name: r.name,
              radiusFromKm: Number(r.radiusFromKm),
              radiusToKm: r.radiusToKm == null ? null : Number(r.radiusToKm),
              starterFeeUzs: Number(r.starterFeeUzs),
              distanceRateUzs: r.distanceRateUzs == null ? null : Number(r.distanceRateUzs),
              sortOrder: r.sortOrder,
            })),
          }
        : null,
    }));
  }
}
