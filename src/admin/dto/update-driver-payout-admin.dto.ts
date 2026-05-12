import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateDriverPayoutAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  payoutIban?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  payoutAccountName?: string;
}
