import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TrackingModule } from '../tracking/tracking.module';
import { SalomOperatorGuard } from '../orders/guards/salom-operator.guard';
import { DriverTripsController } from './driver-trips.controller';
import { OperatorTripsController } from './operator-trips.controller';
import { FareMeterService } from './fare-meter.service';
import { TripsService } from './trips.service';

@Module({
  imports: [PrismaModule, TrackingModule, LedgerModule, OrdersModule, NotificationsModule, AuthModule],
  controllers: [DriverTripsController, OperatorTripsController],
  providers: [TripsService, FareMeterService, SalomOperatorGuard],
  exports: [TripsService, FareMeterService],
})
export class TripsModule {}
