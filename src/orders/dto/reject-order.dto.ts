import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectNote?: string;
}
