import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";

export enum DriverBroadcastAudience {
  ALL_APPROVED = "all_approved",
  ZONE = "zone",
  SINGLE_DRIVER = "single_driver",
}

export class DriverBroadcastChannelsDto {
  @IsOptional()
  @IsBoolean()
  socket?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;
}

export class SendDriverBroadcastDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(4000)
  body!: string;

  @IsEnum(DriverBroadcastAudience)
  audience!: DriverBroadcastAudience;

  @ValidateNested()
  @IsOptional()
  @Type(() => DriverBroadcastChannelsDto)
  channels?: DriverBroadcastChannelsDto;

  @ValidateIf(
    (o: SendDriverBroadcastDto) => o.audience === DriverBroadcastAudience.ZONE,
  )
  @IsUUID()
  serviceZoneId!: string | undefined;

  @ValidateIf(
    (o: SendDriverBroadcastDto) =>
      o.audience === DriverBroadcastAudience.SINGLE_DRIVER,
  )
  @IsUUID()
  driverId!: string | undefined;
}
