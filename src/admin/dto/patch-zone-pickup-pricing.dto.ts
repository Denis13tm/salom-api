import { Type } from "class-transformer";
import { IsInt, IsNumber, IsOptional, Max, Min } from "class-validator";

/** Default pricing profile: kutish va km bazaviy stavkalar (pickup ringlar alohida). */
export class PatchZonePickupPricingDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(240)
  freeWaitMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  waitPerMinuteUzs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cityKmRateUzs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  outsideKmRateUzs?: number;
}
