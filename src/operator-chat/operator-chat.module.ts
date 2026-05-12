import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DriverWsModule } from '../driver-ws/driver-ws.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SalomOperatorGuard } from '../orders/guards/salom-operator.guard';
import { SalomDriverGuard } from '../tracking/guards/salom-driver.guard';
import { TrackingModule } from '../tracking/tracking.module';
import { DriverChatController } from './driver-chat.controller';
import { OperatorChatApiController } from './operator-chat.controller';
import { OperatorChatService } from './operator-chat.service';

/** `OrdersModule` import qilinmaydi — `OrdersModule → AdminModule → OperatorChatModule` tsikli Renderda `OrdersModule === undefined` xatosiga olib kelardi. Guard bu yerda ro‘yxatdan o‘tgan. */
@Module({
  imports: [PrismaModule, AuthModule, TrackingModule, DriverWsModule],
  controllers: [DriverChatController, OperatorChatApiController],
  providers: [OperatorChatService, SalomOperatorGuard, SalomDriverGuard],
  exports: [OperatorChatService],
})
export class OperatorChatModule {}
