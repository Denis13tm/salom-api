import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { AdminService } from '../admin/admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { OperatorPatchDriverProfileDto } from './dto/operator-patch-driver-profile.dto';
import { SalomOperatorGuard } from './guards/salom-operator.guard';

const OPERATOR_NO_DRIVER_DELETE = new ForbiddenException(
  "Haydovchini o‘chirish faqat Admin panel orqali mumkin.",
);
const OPERATOR_NO_DRIVER_DOCS = new ForbiddenException(
  "Hujjat fayllarini ochish faqat Admin panelda.",
);
const OPERATOR_PROFILE_EDIT_FORBIDDEN = new ForbiddenException(
  "Haydovchining shaxsiy ma’lumoti, zonasi va transportini tahrirlash faqat Administrator uchun. Operator faqat ichki eslatmani (Operator eslatmasi) yangilashi mumkin.",
);

@Controller({ path: 'operator/drivers', version: '1' })
@UseGuards(SalomOperatorGuard)
export class OperatorDriversController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingService,
    private readonly admin: AdminService,
  ) {}

  @Get()
  list(@Req() req: Request, @Query('serviceZoneId') serviceZoneId?: string) {
    return this.resolvedZoneRoster(req.salomOperatorId!, serviceZoneId);
  }

  /** Tanlangan zonadagi haydovchi — operatsiya uchun yengil profil (moliya/hujjatlar — Admin). */
  @Get(':driverId/profile')
  async getProfile(
    @Req() req: Request,
    @Param('driverId') driverId: string,
    @Query('serviceZoneId') serviceZoneId?: string,
  ) {
    const opId = req.salomOperatorId!;
    const zone = await this.resolvedServiceZoneId(opId, serviceZoneId);
    await this.assertDriverInServiceZone(driverId, zone);
    return this.admin.getDriverProfileForOperator(driverId);
  }

  @Patch(':driverId/profile')
  async patchProfile(
    @Req() req: Request,
    @Param('driverId') driverId: string,
    @Query('serviceZoneId') serviceZoneId: string | undefined,
    @Body() body: OperatorPatchDriverProfileDto,
  ) {
    const opId = req.salomOperatorId!;
    const zone = await this.resolvedServiceZoneId(opId, serviceZoneId);
    await this.assertDriverInServiceZone(driverId, zone);

    await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId } });

    const triesRestrictedPatch =
      body.firstName !== undefined ||
      body.lastName !== undefined ||
      body.passportOrId !== undefined ||
      body.referralNote !== undefined ||
      body.serviceZoneId !== undefined ||
      body.primaryVehicle !== undefined;
    if (triesRestrictedPatch) {
      throw OPERATOR_PROFILE_EDIT_FORBIDDEN;
    }

    const data: Prisma.DriverUpdateInput = {};
    if (body.adminNotes !== undefined) data.adminNotes = body.adminNotes;

    if (Object.keys(data).length > 0) {
      await this.prisma.driver.update({ where: { id: driverId }, data });
    }

    return this.admin.getDriverProfileForOperator(driverId);
  }

  @Delete(':driverId')
  @HttpCode(200)
  deleteDriver() {
    throw OPERATOR_NO_DRIVER_DELETE;
  }

  @Get(':driverId/documents/:docId/file')
  getDocumentFile(): never {
    throw OPERATOR_NO_DRIVER_DOCS;
  }

  private async resolvedZoneRoster(operatorId: string, serviceZoneId?: string) {
    const zone = await this.resolvedServiceZoneId(operatorId, serviceZoneId);
    return this.tracking.listDriversRosterForZone(zone);
  }

  private async resolvedServiceZoneId(operatorId: string, serviceZoneId?: string) {
    const op = await this.prisma.operator.findUnique({
      where: { id: operatorId },
      select: { serviceZoneId: true },
    });
    const zone = (serviceZoneId?.trim() || op?.serviceZoneId)?.trim() || null;
    if (!zone) {
      throw new BadRequestException('serviceZoneId kerak (query) yoki operator profilida zona belgilangan bo‘lsin');
    }
    return zone;
  }

  private async assertDriverInServiceZone(driverId: string, serviceZoneId: string) {
    const row = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, serviceZoneId: true },
    });
    if (!row) {
      throw new NotFoundException('Haydovchi topilmadi');
    }
    if (row.serviceZoneId !== serviceZoneId) {
      throw new ForbiddenException('Bu haydovchi tanlangan xizmat zonasida emas');
    }
  }
}
