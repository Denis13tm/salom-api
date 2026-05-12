import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TrackingModule } from '../tracking/tracking.module';
import { jwtModuleRegister } from '../config/jwt-module.register';
import { DriverDeviceController } from './driver-device.controller';
import { DriverNewsController } from './driver-news.controller';
import { SmsDeliveryWebhookController } from './sms-delivery-webhook.controller';
import { FcmAdminService } from './fcm-admin.service';
import { OperationalNotificationsService } from './operational-notifications.service';
import { PushService } from './push.service';
import { SmsService } from './sms.service';
import { DriverNewsService } from './driver-news.service';

@Module({
  imports: [PrismaModule, ConfigModule, jwtModuleRegister, forwardRef(() => TrackingModule)],
  controllers: [DriverDeviceController, DriverNewsController, SmsDeliveryWebhookController],
  providers: [
    FcmAdminService,
    SmsService,
    PushService,
    OperationalNotificationsService,
    DriverNewsService,
  ],
  exports: [SmsService, PushService, OperationalNotificationsService],
})
export class NotificationsModule {}
