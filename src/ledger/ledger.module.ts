import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { TrackingModule } from "../tracking/tracking.module";
import { DriverLedgerController } from "./driver-ledger.controller";
import { LedgerService } from "./ledger.service";

@Module({
  imports: [PrismaModule, TrackingModule, AuthModule],
  controllers: [DriverLedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
