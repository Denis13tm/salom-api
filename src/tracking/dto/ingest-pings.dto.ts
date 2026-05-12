import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class LocationPingInDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5000)
  accuracyM?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(400)
  speedKmh?: number;

  @IsOptional()
  @IsISO8601()
  recordedAt?: string;

  @IsOptional()
  @IsUUID("4")
  orderId?: string;

  @IsOptional()
  @IsUUID("4")
  tripId?: string;

  @IsOptional()
  @IsString()
  @Max(32)
  source?: string;
}

export class IngestPingsBodyDto {
  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => LocationPingInDto)
  pings!: LocationPingInDto[];
}
