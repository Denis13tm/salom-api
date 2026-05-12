import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel, NotificationDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FcmAdminService } from './fcm-admin.service';

function trimErr(s: string, max = 2000) {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Haydovchi push: `NotificationLog`; `PUSH_MODE=fcm` — FCM HTTP v1 (token bo‘lmasa yoki FCM o‘rnatilmasa FAILED). */
@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fcm: FcmAdminService,
  ) {}

  async notifyDriver(
    driverId: string,
    orderId: string | null,
    template: string,
    body: string,
    data?: Record<string, string>,
    options?: { pushTitle?: string | null },
  ): Promise<{ logId: string; delivered: boolean }> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { userId: true, fcmToken: true },
    });
    if (!driver) {
      return { logId: '', delivered: false };
    }
    const row = await this.prisma.notificationLog.create({
      data: {
        userId: driver.userId,
        orderId,
        channel: NotificationChannel.PUSH,
        template,
        body,
        status: NotificationDeliveryStatus.QUEUED,
      },
    });
    const mode = (this.config.get<string>('PUSH_MODE') ?? 'log').toLowerCase();
    if (mode === 'log' || mode === 'stub') {
      await this.prisma.notificationLog.update({
        where: { id: row.id },
        data: { status: NotificationDeliveryStatus.SENT, sentAt: new Date() },
      });
      this.log.debug(`push(log) driver=${driverId} ${template}`);
      return { logId: row.id, delivered: true };
    }

    if (mode === 'fcm') {
      if (!driver.fcmToken) {
        const err = 'no_fcm_token';
        await this.prisma.notificationLog.update({
          where: { id: row.id },
          data: {
            status: NotificationDeliveryStatus.FAILED,
            error: err,
            sentAt: new Date(),
          },
        });
        this.log.debug(`push(fcm) skip: ${err} driver=${driverId}`);
        return { logId: row.id, delivered: false };
      }
      if (!this.fcm.isReady()) {
        const err = 'fcm_not_configured';
        await this.prisma.notificationLog.update({
          where: { id: row.id },
          data: {
            status: NotificationDeliveryStatus.FAILED,
            error: err,
            sentAt: new Date(),
          },
        });
        this.log.warn(`push(fcm): ${err}`);
        return { logId: row.id, delivered: false };
      }
      const pushTitle = options?.pushTitle?.trim() || 'Salom Taxi';
      const dataMap: Record<string, string> = { template, ...(data ?? {}) };
      dataMap['title'] = pushTitle;
      if (orderId) dataMap['orderId'] = orderId;
      const messaging = this.fcm.getMessaging();
      try {
        await messaging.send({
          token: driver.fcmToken,
          notification: { title: pushTitle, body },
          data: dataMap,
          android: { priority: 'high' },
        });
        await this.prisma.notificationLog.update({
          where: { id: row.id },
          data: { status: NotificationDeliveryStatus.SENT, sentAt: new Date() },
        });
        this.log.debug(`push(fcm) sent driver=${driverId} ${template}`);
        return { logId: row.id, delivered: true };
      } catch (e) {
        const code =
          e && typeof e === 'object' && 'code' in e
            ? String((e as { code: string }).code)
            : 'unknown';
        const msg = trimErr(e instanceof Error ? e.message : String(e));
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          await this.prisma.driver
            .update({ where: { id: driverId }, data: { fcmToken: null } })
            .catch(() => undefined);
        }
        await this.prisma.notificationLog.update({
          where: { id: row.id },
          data: {
            status: NotificationDeliveryStatus.FAILED,
            error: msg,
            sentAt: new Date(),
          },
        });
        this.log.warn(`push(fcm) fail driver=${driverId} code=${code} ${msg}`);
        return { logId: row.id, delivered: false };
      }
    }

    await this.prisma.notificationLog.update({
      where: { id: row.id },
      data: { status: NotificationDeliveryStatus.SENT, sentAt: new Date() },
    });
    return { logId: row.id, delivered: true };
  }
}
