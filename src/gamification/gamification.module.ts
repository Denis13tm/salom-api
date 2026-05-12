import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { TrackingModule } from "../tracking/tracking.module";
import { DriverChampionsController } from "./driver-champions.controller";
import { GamificationService } from "./gamification.service";
import { PublicChampionsBannersController } from "./public-champions-banners.controller";

@Module({
  imports: [PrismaModule, TrackingModule, AuthModule],
  controllers: [DriverChampionsController, PublicChampionsBannersController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
