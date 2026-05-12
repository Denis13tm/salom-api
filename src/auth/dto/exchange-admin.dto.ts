import { IsUUID } from "class-validator";

export class ExchangeAdminDto {
  @IsUUID("4")
  adminId!: string;
}
