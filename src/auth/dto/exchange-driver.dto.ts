import { IsUUID } from "class-validator";

export class ExchangeDriverDto {
  @IsUUID("4")
  driverId!: string;
}
