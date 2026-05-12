import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule, type JwtModuleOptions } from "@nestjs/jwt";

/** JWT sozlamasi bitta joyda (Auth, Notifications, Tracking guardlar). */
export const jwtModuleRegister = JwtModule.registerAsync({
  imports: [ConfigModule],
  useFactory: (c: ConfigService): JwtModuleOptions => ({
    secret: c.getOrThrow<string>("JWT_SECRET"),
    signOptions: {
      expiresIn:
        c.get<string>("JWT_ACCESS_EXPIRES")?.trim() ||
        c.get<string>("JWT_EXPIRES", "7d"),
    } as JwtModuleOptions["signOptions"],
  }),
  inject: [ConfigService],
});
