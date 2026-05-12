import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class OperatorPrimaryVehicleDto {
  @IsOptional() @IsString() @MaxLength(32) plate?: string;
  @IsOptional() @IsString() @MaxLength(200) makeModel?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1990) @Max(2035) year?: number | null;
  @IsOptional() @IsString() @MaxLength(80) color?: string | null;
}

export class OperatorPatchDriverProfileDto {
  @IsOptional() @IsString() @MaxLength(120) firstName?: string | null;
  @IsOptional() @IsString() @MaxLength(120) lastName?: string | null;
  @IsOptional() @IsString() @MaxLength(64) passportOrId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) referralNote?: string | null;
  @IsOptional() @IsString() @IsUUID() serviceZoneId?: string | null;
  @IsOptional() @IsString() @MaxLength(20_000) adminNotes?: string | null;
  @IsOptional() @ValidateNested() @Type(() => OperatorPrimaryVehicleDto) primaryVehicle?: OperatorPrimaryVehicleDto;
}
