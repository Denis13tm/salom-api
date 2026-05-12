import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { jwtModuleRegister } from "../config/jwt-module.register";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AuthV1Controller } from "./auth.v1.controller";
import { AuthService } from "./auth.service";
import { OtpService } from "./otp.service";

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    jwtModuleRegister,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [AuthV1Controller],
  providers: [AuthService, OtpService],
  exports: [AuthService, OtpService, JwtModule],
})
export class AuthModule {}
