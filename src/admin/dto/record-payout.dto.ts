import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";

export class RecordPayoutDto {
  @IsUUID("4")
  driverId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountUzs!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
