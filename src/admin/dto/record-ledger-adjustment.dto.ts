import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RecordLedgerAdjustmentDto {
  @IsUUID('4')
  driverId!: string;

  /** Musbat — balansga qo‘shish; manfiy — ayirish (komissiya tuzatish, qaytarish). */
  @Type(() => Number)
  @IsInt()
  amountUzs!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
