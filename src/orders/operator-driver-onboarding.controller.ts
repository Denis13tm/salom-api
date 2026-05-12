import { BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from '../admin/admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalomOperatorGuard } from './guards/salom-operator.guard';

type OperatorRequest = Request & { salomOperatorId?: string };

const DRIVER_MUTATIONS_ADMIN_ONLY = new ForbiddenException(
  "Haydovchini tasdiqlash, rad etish yoki UNDER_REVIEW ga o'tkazish faqat Admin panel orqali mumkin (audit va xavfsizlik). Operator arizani faqat ko'radi.",
);

/**
 * Operator panel: o‘z xizmat zonasidagi haydovchi arizalarini ko‘rish (read-only).
 * Tasdiq/rad — {@link AdminService} orqali faqat admin.
 */
@Controller({ path: 'operator/drivers/onboarding', version: '1' })
@UseGuards(SalomOperatorGuard)
export class OperatorDriverOnboardingController {
  constructor(
    private readonly admin: AdminService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('pending')
  async listPending(@Req() req: OperatorRequest, @Query('serviceZoneId') serviceZoneId?: string) {
    const zone = await this.resolvedZone(req, serviceZoneId);
    return this.admin.listPendingDriversInServiceZone(zone);
  }

  @Get(':driverId/documents/:docId/file')
  async driverDocumentFile(
    @Req() req: OperatorRequest,
    @Param('driverId') driverId: string,
    @Param('docId') docId: string,
    @Query('serviceZoneId') serviceZoneId?: string,
  ): Promise<StreamableFile> {
    const zone = await this.resolvedZone(req, serviceZoneId);
    await this.assertDriverInZone(driverId, zone);
    const { stream, mimeType } = await this.admin.openDriverDocumentStream(driverId, docId);
    return new StreamableFile(stream, { type: mimeType, disposition: `inline; filename="doc-${docId}"` });
  }

  @Get(':driverId')
  async getDetail(
    @Req() req: OperatorRequest,
    @Param('driverId') driverId: string,
    @Query('serviceZoneId') serviceZoneId?: string,
  ) {
    const zone = await this.resolvedZone(req, serviceZoneId);
    await this.assertDriverInZone(driverId, zone);
    return this.admin.getDriver(driverId);
  }

  @Post(':driverId/approve')
  approve() {
    throw DRIVER_MUTATIONS_ADMIN_ONLY;
  }

  @Post(':driverId/reject')
  reject() {
    throw DRIVER_MUTATIONS_ADMIN_ONLY;
  }

  @Post(':driverId/under-review')
  underReview() {
    throw DRIVER_MUTATIONS_ADMIN_ONLY;
  }

  private async resolvedZone(req: OperatorRequest, serviceZoneId?: string): Promise<string> {
    const op = await this.prisma.operator.findUnique({
      where: { id: req.salomOperatorId! },
      select: { serviceZoneId: true },
    });
    const zone = (serviceZoneId?.trim() || op?.serviceZoneId)?.trim() || null;
    if (!zone) {
      throw new BadRequestException('serviceZoneId kerak (query) yoki operator profilida zona belgilangan bo‘lsin');
    }
    return zone;
  }

  private async assertDriverInZone(driverId: string, serviceZoneId: string) {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, serviceZoneId: true },
    });
    if (!d) {
      throw new NotFoundException('Driver not found');
    }
    if (d.serviceZoneId !== serviceZoneId) {
      throw new ForbiddenException("Bu haydovchi bu zonadagi ariza sifatida ko'rinmaydi (zona mos emas).");
    }
  }
}
