import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DriverGateway } from './driver.gateway';

@Module({
  imports: [PrismaModule, AuthModule, ConfigModule],
  providers: [DriverGateway],
  exports: [DriverGateway],
})
export class DriverWsModule {}
