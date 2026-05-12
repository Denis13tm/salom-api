import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateZoneMeterDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  starterFeeUzs?: number;

  /** Birinchi N daqiqa tekin kutish */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(120)
  waitingFreeMinutes?: number;

  /** Tekin tugagach har daqiqa */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  waitingFeePerMinuteUzs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  meterBaseUzs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  meterPerKmUzs?: number;

  @IsOptional()
  @IsBoolean()
  clearMeter?: boolean;
}
