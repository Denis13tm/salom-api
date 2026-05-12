import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

export class PatchDriverOnboardingDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  passportOrId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  referralNote?: string;

  @IsOptional()
  @IsUUID()
  serviceZoneId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  vehiclePlate?: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== "")
  @IsString()
  @Matches(/^\d{2}$/, { message: "Viloyat kodi 2 ta raqam (masalan 01)" })
  vehiclePlateRegionCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  vehicleMakeModel?: string;

  @IsOptional()
  @IsInt()
  @Min(1980)
  @Max(2035)
  vehicleYear?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  vehicleColor?: string;
}
