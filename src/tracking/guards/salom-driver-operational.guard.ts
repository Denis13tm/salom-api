import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserAccountStatus, DriverOnboardingStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Buyurtma / safar / kuzatuv: faqat tasdiqlangan, faol va (agar kod berilgan bo‘lsa) aktivatsiya qilingan haydovchi.
 * Legacy: `activationCode` null.
 */
@Injectable()
export class SalomDriverOperationalGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { salomDriverId?: string }>();
    const id = req.salomDriverId;
    if (!id) {
      throw new ForbiddenException('Driver context required');
    }
    const row = await this.prisma.driver.findUnique({
      where: { id },
      include: { user: { select: { status: true } } },
    });
    if (!row) {
      throw new ForbiddenException('Unknown driver');
    }
    if (row.user.status === UserAccountStatus.SUSPENDED) {
      throw new ForbiddenException('Hisob to‘xtatilgan');
    }
    if (row.onboardingStatus !== DriverOnboardingStatus.APPROVED) {
      throw new ForbiddenException('Ariza hali ofitsial tasdiqlanmagan yoki rad etilgan');
    }
    if (row.user.status !== UserAccountStatus.ACTIVE) {
      throw new ForbiddenException('Hisob faol emas (admin tasdig‘i kutilmoqda)');
    }
    if (row.activationCode && !row.appActivatedAt) {
      throw new ForbiddenException('Ilovani 12 xonali kod bilan faollashtiring');
    }
    return true;
  }
}
