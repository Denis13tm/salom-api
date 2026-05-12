import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { envValidationSchema } from "./config/env.validation";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { TrackingModule } from "./tracking/tracking.module";
import { OrdersModule } from "./orders/orders.module";
import { TripsModule } from "./trips/trips.module";
import { LedgerModule } from "./ledger/ledger.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { AdminModule } from "./admin/admin.module";
import { DriverOnboardingModule } from "./driver-onboarding/driver-onboarding.module";
import { OperatorChatModule } from "./operator-chat/operator-chat.module";
import { GamificationModule } from "./gamification/gamification.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    TrackingModule,
    NotificationsModule,
    OrdersModule,
    TripsModule,
    LedgerModule,
    AdminModule,
    DriverOnboardingModule,
    OperatorChatModule,
    GamificationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
