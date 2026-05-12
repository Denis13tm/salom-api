import { LedgerModule } from '../ledger/ledger.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TrackingModule } from '../tracking/tracking.module';
import { DriverWsModule } from '../driver-ws/driver-ws.module';
import { DriverOrdersController } from './driver-orders.controller';
import { DispatchService } from './dispatch.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OperatorDriverOnboardingController } from './operator-driver-onboarding.controller';
import { OperatorMeController } from './operator-me.controller';
import { OperatorOrdersController } from './operator-orders.controller';
import { OperatorDriversController } from './operator-drivers.controller';
import { SalomOperatorGuard } from './guards/salom-operator.guard';
import { PricingEngineService } from './pricing-engine.service';

@Module({
  imports: [ConfigModule, PrismaModule, TrackingModule, NotificationsModule, AuthModule, AdminModule, DriverWsModule, LedgerModule],
  controllers: [
    OperatorOrdersController,
    OperatorMeController,
    OperatorDriversController,
    OperatorDriverOnboardingController,
    DriverOrdersController,
  ],
  providers: [DispatchService, SalomOperatorGuard, OrderLifecycleService, PricingEngineService],
  exports: [DispatchService, DriverWsModule, OrderLifecycleService, PricingEngineService],
})
export class OrdersModule {}
