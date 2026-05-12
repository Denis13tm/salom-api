import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import IORedis from "ioredis";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SalomDriverGuard } from "./guards/salom-driver.guard";
import { SalomDriverOperationalGuard } from "./guards/salom-driver-operational.guard";
import { LastKnownStore } from "./last-known.store";
import { AdminGateway } from "./admin.gateway";
import { OperatorGateway } from "./operator.gateway";
import { REDIS_CLIENT } from "./redis-tokens";
import { TrackingController } from "./tracking.controller";
import { TrackingService } from "./tracking.service";

@Module({
  imports: [ConfigModule, PrismaModule, forwardRef(() => AuthModule)],
  controllers: [TrackingController],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const u = config.get<string | undefined>("REDIS_URL");
        if (!u) return null;
        return new IORedis(u, { maxRetriesPerRequest: 2 });
      },
      inject: [ConfigService],
    },
    LastKnownStore,
    OperatorGateway,
    AdminGateway,
    TrackingService,
    SalomDriverGuard,
    SalomDriverOperationalGuard,
  ],
  exports: [
    TrackingService,
    LastKnownStore,
    OperatorGateway,
    AdminGateway,
    SalomDriverGuard,
    SalomDriverOperationalGuard,
  ],
})
export class TrackingModule {}
