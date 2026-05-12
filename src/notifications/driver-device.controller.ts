import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Patch,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  DriverOnboardingStatus,
  DriverOperationalStatus,
  UserAccountStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SalomDriverGuard } from "../tracking/guards/salom-driver.guard";
import { normalizePhoneUz } from "../driver-onboarding/phone.util";
import { SetDriverPresenceDto } from "./dto/set-driver-presence.dto";
import { SetFcmTokenDto } from "./dto/set-fcm-token.dto";
import { UpdatePayoutDestinationDto } from "./dto/update-payout-destination.dto";
import { UpdatePhoneDto } from "./dto/update-phone.dto";

const CANT_OFFLINE: DriverOperationalStatus[] = [
  DriverOperationalStatus.EN_ROUTE_PICKUP,
  DriverOperationalStatus.ARRIVED_PICKUP,
  DriverOperationalStatus.IN_TRIP,
];

@Controller({ path: "drivers/me", version: "1" })
@UseGuards(SalomDriverGuard)
export class DriverDeviceController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Operator panel va broadcast `operationalStatus` (ONLINE_IDLE / OFFLINE) shu yerdan.
   * Ilova “onlayn”ni bosing: `online: true`. Oflayn: `false`.
   *
   * **SUSPENDED** hisob: faqat-oflayn ruxsat (operator xaritasidagi “onlayn” qoldiqlarini yo‘q qilish uchun),
   * yangi zakaz uchun `online: true` — rad etiladi.
   */
  @Patch("presence")
  async setPresence(@Req() req: Request, @Body() body: SetDriverPresenceDto) {
    const id = req.salomDriverId!;
    const d = await this.prisma.driver.findUniqueOrThrow({
      where: { id },
      include: { user: { select: { status: true } } },
    });

    if (!body.online) {
      if (CANT_OFFLINE.includes(d.operationalStatus)) {
        throw new ConflictException(
          "Safar davomida oflayn bo‘lish mumkin emas",
        );
      }
      return this.prisma.driver.update({
        where: { id },
        data: { operationalStatus: DriverOperationalStatus.OFFLINE },
        select: { id: true, operationalStatus: true },
      });
    }

    if (d.user.status === UserAccountStatus.SUSPENDED) {
      throw new BadRequestException(
        "Hisob vaqtincha toʻxtatilgan — buyurtma va yangi takliflar oʻchiq. Qo‘llab-quvvatlash bilan bog‘laning.",
      );
    }
    if (d.onboardingStatus !== DriverOnboardingStatus.APPROVED) {
      throw new BadRequestException("Ariza hali ofitsial tasdiqlanmagan");
    }
    if (d.user.status !== UserAccountStatus.ACTIVE) {
      throw new BadRequestException("Hisob faol emas");
    }
    if (d.activationCode && !d.appActivatedAt) {
      throw new BadRequestException(
        "Ilovani 12 xonali kod bilan faollashtiring",
      );
    }
    if (d.operationalStatus === DriverOperationalStatus.SUSPENDED) {
      throw new BadRequestException(
        "Haydovchi profili bloklangan — operatorga murojaat qiling",
      );
    }

    if (CANT_OFFLINE.includes(d.operationalStatus)) {
      throw new ConflictException(
        "Safar yoki yetib borgan holat — avval safarni bosing",
      );
    }
    if (
      d.operationalStatus === DriverOperationalStatus.ONLINE_IDLE ||
      d.operationalStatus === DriverOperationalStatus.ORDER_OFFERED
    ) {
      return { id, operationalStatus: d.operationalStatus };
    }
    return this.prisma.driver.update({
      where: { id },
      data: { operationalStatus: DriverOperationalStatus.ONLINE_IDLE },
      select: { id: true, operationalStatus: true },
    });
  }

  @Put("device")
  setDevice(@Req() req: Request, @Body() body: SetFcmTokenDto) {
    return this.prisma.driver.update({
      where: { id: req.salomDriverId! },
      data: {
        fcmToken: body.fcmToken ?? null,
        clientDeviceId:
          body.clientDeviceId === undefined
            ? undefined
            : (body.clientDeviceId ?? null),
      },
      select: { id: true, fcmToken: true, clientDeviceId: true },
    });
  }

  @Get("payout-destination")
  getPayout(@Req() req: Request) {
    return this.prisma.driver.findUniqueOrThrow({
      where: { id: req.salomDriverId! },
      select: { payoutIban: true, payoutAccountName: true },
    });
  }

  @Patch("phone")
  async updatePhone(@Req() req: Request, @Body() body: UpdatePhoneDto) {
    const expect = normalizePhoneUz(body.phone);
    const d = await this.prisma.driver.findUniqueOrThrow({
      where: { id: req.salomDriverId! },
      select: { userId: true },
    });
    const conflict = await this.prisma.user.findFirst({
      where: { phone: expect, id: { not: d.userId } },
      select: { id: true },
    });
    if (conflict) {
      throw new BadRequestException("Bu telefon raqami allaqachon band");
    }
    return this.prisma.user.update({
      where: { id: d.userId },
      data: { phone: expect },
      select: { phone: true },
    });
  }

  @Patch("payout-destination")
  async setPayout(
    @Req() req: Request,
    @Body() body: UpdatePayoutDestinationDto,
  ) {
    const data: {
      payoutIban?: string | null;
      payoutAccountName?: string | null;
    } = {};
    if (body.payoutIban !== undefined) {
      const t = (body.payoutIban ?? "")
        .trim()
        .replace(/\s+/g, "")
        .toUpperCase();
      data.payoutIban = t.length ? t : null;
    }
    if (body.payoutAccountName !== undefined) {
      const t = (body.payoutAccountName ?? "").trim();
      data.payoutAccountName = t.length ? t : null;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        "Kamida bitta maydon: payoutIban yoki payoutAccountName",
      );
    }
    return this.prisma.driver.update({
      where: { id: req.salomDriverId! },
      data,
      select: { id: true, payoutIban: true, payoutAccountName: true },
    });
  }
}
