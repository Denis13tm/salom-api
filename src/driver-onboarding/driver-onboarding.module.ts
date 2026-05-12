import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { TrackingModule } from "../tracking/tracking.module";
import { PublicDriverController } from "./public-driver.controller";
import { DriverOnboardingMeController } from "./driver-onboarding.me.controller";
import { PublicServiceZonesController } from "./public-service-zones.controller";
import { RegistrationService } from "./registration.service";
import { OnboardingService } from "./onboarding.service";

@Module({
  imports: [PrismaModule, AuthModule, TrackingModule],
  controllers: [
    PublicDriverController,
    DriverOnboardingMeController,
    PublicServiceZonesController,
  ],
  providers: [RegistrationService, OnboardingService],
  exports: [OnboardingService, RegistrationService],
})
export class DriverOnboardingModule {}
