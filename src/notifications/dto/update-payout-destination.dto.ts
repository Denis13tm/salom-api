import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Haydovchi o‘zi to‘ldiradigan bank / IBAN. Bo‘sh string = o‘chirish. */
export class UpdatePayoutDestinationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  payoutIban?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  payoutAccountName?: string;
}
