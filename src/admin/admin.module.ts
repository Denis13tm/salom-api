import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DriverOnboardingModule } from "../driver-onboarding/driver-onboarding.module";
import { GamificationModule } from "../gamification/gamification.module";
import { LedgerModule } from "../ledger/ledger.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { OperatorChatModule } from "../operator-chat/operator-chat.module";
import { PrismaModule } from "../prisma/prisma.module";
import { DriverWsModule } from "../driver-ws/driver-ws.module";
import { AdminChatController } from "./admin-chat.controller";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { SalomAdminGuard } from "./salom-admin.guard";
import { PricingEngineService } from "../orders/pricing-engine.service";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    NotificationsModule,
    LedgerModule,
    DriverWsModule,
    OperatorChatModule,
    DriverOnboardingModule,
    GamificationModule,
  ],
  controllers: [AdminController, AdminChatController],
  providers: [AdminService, SalomAdminGuard, PricingEngineService],
  exports: [AdminService],
})
export class AdminModule {}
