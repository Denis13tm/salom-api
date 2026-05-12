import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SmsDeliveryWebhookDto } from './dto/sms-delivery-webhook.dto';

@Controller({ path: 'webhooks', version: '1' })
export class SmsDeliveryWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Provayder SMS yetkazish holatini yangilaydi (server-to-server). */
  @Post('sms/delivery')
  async delivery(
    @Headers('x-salom-sms-secret') secret: string | undefined,
    @Body() body: SmsDeliveryWebhookDto,
  ) {
    const expected = (this.config.get<string>('SMS_DELIVERY_WEBHOOK_SECRET') ?? '').trim();
    if (!expected) {
      throw new ForbiddenException('SMS delivery webhook not configured');
    }
    if (!secret || secret.trim() !== expected) {
      throw new UnauthorizedException();
    }
    const st =
      body.status === 'DELIVERED'
        ? SmsDeliveryStatus.DELIVERED
        : body.status === 'FAILED'
          ? SmsDeliveryStatus.FAILED
          : SmsDeliveryStatus.SENT;
    const now = new Date();
    await this.prisma.sMSLog.update({
      where: { id: body.logId },
      data: {
        status: st,
        error: st === SmsDeliveryStatus.FAILED ? (body.error ?? 'failed') : null,
        ...(st !== SmsDeliveryStatus.FAILED ? { sentAt: now } : {}),
      },
    });
    return { ok: true as const };
  }
}
