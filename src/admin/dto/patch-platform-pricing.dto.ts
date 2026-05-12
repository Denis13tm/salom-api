import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PatchPlatformPricingDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  platformCommissionBps?: number;

  /** Yangi buyurtma uchun minimal komissiya balansi (so‘m). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50_000_000)
  commissionWalletMinBroadcastBalanceUzs?: number;

  /** «Kam qoldi» chegara (so‘m), min dan kam bo‘lmasligi kerak (server tekshiradi). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50_000_000)
  commissionWalletLowBalanceUzs?: number;
}
