import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CancelOrderDto {
  @IsOptional()
  @IsUUID("4")
  cancellationReasonId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelNote?: string;
}
