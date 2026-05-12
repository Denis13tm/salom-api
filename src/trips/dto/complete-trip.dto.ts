import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class CompleteTripDto {
  /** Yakuniy narx (so‘m). Bo‘lmasa order dagi `operatorEnteredFareUzs` ishlatiladi. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fareUzs?: number;
}
