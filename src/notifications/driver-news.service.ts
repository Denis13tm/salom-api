import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DriverNewsService {
  constructor(private readonly prisma: PrismaService) {}

  private async broadcastOrForDriver(
    driverId: string,
  ): Promise<Prisma.AdminNewsBroadcastWhereInput | null> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { serviceZoneId: true },
    });
    if (!driver) {
      return null;
    }
    const or: Prisma.AdminNewsBroadcastWhereInput[] = [
      { audience: "all_approved" },
      { audience: "single_driver", targetDriverId: driverId },
    ];
    if (driver.serviceZoneId) {
      or.push({ audience: "zone", serviceZoneId: driver.serviceZoneId });
    }
    return { OR: or };
  }

  /**
   * Haydovchiga tegishli admin yangiliklari: umumiy, zona yoki shaxsiy yuborilganlar.
   * `read` — haydovchi o‘qiganini belgilash (badge).
   */
  async listForDriver(driverId: string, takeRaw?: number) {
    const take = Math.min(100, Math.max(1, takeRaw ?? 50));

    const where = await this.broadcastOrForDriver(driverId);
    if (!where) {
      return { items: [] as const };
    }

    const rows = await this.prisma.adminNewsBroadcast.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        title: true,
        body: true,
        audience: true,
        createdAt: true,
      },
    });

    const ids = rows.map((r) => r.id);
    const readRows =
      ids.length === 0
        ? []
        : await this.prisma.adminNewsDriverRead.findMany({
            where: { driverId, broadcastId: { in: ids } },
            select: { broadcastId: true },
          });
    const readSet = new Set(readRows.map((x) => x.broadcastId));

    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        audience: r.audience,
        createdAt: r.createdAt.toISOString(),
        read: readSet.has(r.id),
      })),
    };
  }

  /** Xarita bell badge — o‘qilmagan administrator yangiliklari soni. */
  async unreadCountForDriver(driverId: string) {
    const where = await this.broadcastOrForDriver(driverId);
    if (!where) {
      return { count: 0 };
    }
    const count = await this.prisma.adminNewsBroadcast.count({
      where: {
        AND: [
          where,
          {
            reads: {
              none: { driverId },
            },
          },
        ],
      },
    });
    return { count };
  }

  /** Mobil ochganda / ro‘yxatni ko‘rganda chaqiriladi. */
  async markRead(driverId: string, broadcastIds: string[]) {
    const unique = [...new Set(broadcastIds)].filter(Boolean);
    if (unique.length === 0) {
      return { ok: true as const, marked: 0 };
    }

    const where = await this.broadcastOrForDriver(driverId);
    if (!where) {
      return { ok: true as const, marked: 0 };
    }

    const allowed = await this.prisma.adminNewsBroadcast.findMany({
      where: {
        AND: [where, { id: { in: unique } }],
      },
      select: { id: true },
    });
    const ids = allowed.map((a) => a.id);
    if (ids.length === 0) {
      return { ok: true as const, marked: 0 };
    }

    await this.prisma.adminNewsDriverRead.createMany({
      data: ids.map((broadcastId) => ({ driverId, broadcastId })),
      skipDuplicates: true,
    });

    return { ok: true as const, marked: ids.length };
  }
}
