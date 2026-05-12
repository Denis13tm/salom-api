import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";

export class CreateDriverVehicleNestedDto {
  @IsString()
  @MaxLength(32)
  plate!: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== "")
  @IsString()
  @Matches(/^\d{2}$/, {
    message: "Viloyat kodi 2 ta raqam (masalan 01 yoki 10)",
  })
  plateRegionCode?: string | null;

  @IsString()
  @MaxLength(120)
  makeModel!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1980)
  @Max(2035)
  year?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  color?: string | null;
}

export class CreateDriverAdminDto {
  @IsString()
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsUUID()
  serviceZoneId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  balanceUzs?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{12}$/, { message: "activationCode 12 ta raqam bo‘lishi kerak" })
  activationCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  passportSeries?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  passportNumber?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateDriverVehicleNestedDto)
  vehicle?: CreateDriverVehicleNestedDto;
}
