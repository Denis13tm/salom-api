import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class ConfirmSettlementDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined ? undefined : String(value),
  )
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
