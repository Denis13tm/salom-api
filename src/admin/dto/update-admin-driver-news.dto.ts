import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { DriverBroadcastAudience } from "./send-driver-broadcast.dto";

/** Admin `AdminNewsBroadcast` qatorini yangilash (haydovchi ro‘yxatidagi ko‘rinish). */
export class UpdateAdminDriverNewsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @IsOptional()
  @IsEnum(DriverBroadcastAudience)
  audience?: DriverBroadcastAudience;

  @ValidateIf(
    (o: UpdateAdminDriverNewsDto) =>
      o.audience === DriverBroadcastAudience.ZONE,
  )
  @IsUUID()
  serviceZoneId?: string;

  @ValidateIf(
    (o: UpdateAdminDriverNewsDto) =>
      o.audience === DriverBroadcastAudience.SINGLE_DRIVER,
  )
  @IsUUID()
  driverId?: string;
}
