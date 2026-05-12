import { IsUUID } from 'class-validator';

export class ExchangeOperatorDto {
  @IsUUID('4')
  operatorId!: string;
}
