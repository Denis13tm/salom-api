import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SalomOperatorGuard } from './guards/salom-operator.guard';
import { UpdateOperatorSelfDto } from './dto/update-operator-self.dto';
import { normalizePhoneUz } from '../driver-onboarding/phone.util';

@Controller({ path: 'operator/me', version: '1' })
@UseGuards(SalomOperatorGuard)
export class OperatorMeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@Req() req: Request) {
    const id = req.salomOperatorId!;
    const op = await this.prisma.operator.findUniqueOrThrow({
      where: { id },
      include: {
        user: { select: { phone: true, status: true, lastLoginAt: true, createdAt: true } },
        serviceZone: { select: { id: true, name: true, slug: true } },
      },
    });
    return {
      id: op.id,
      displayName: op.displayName,
      phone: op.user.phone,
      status: op.user.status,
      serviceZone: op.serviceZone,
      createdAt: op.createdAt,
      updatedAt: op.updatedAt,
      lastLoginAt: op.user.lastLoginAt,
    };
  }

  @Patch()
  async patchMe(@Req() req: Request, @Body() body: UpdateOperatorSelfDto) {
    const id = req.salomOperatorId!;
    const phone = normalizePhoneUz(body.phone);
    const op = await this.prisma.operator.findUniqueOrThrow({
      where: { id },
      select: { userId: true },
    });
    await this.prisma.user.update({
      where: { id: op.userId },
      data: { phone },
    });
    return this.me(req);
  }
}
