import { IsString, MinLength } from "class-validator";

export class UpdatePhoneDto {
  @IsString()
  @MinLength(9)
  /** Yangi raqam (oddiyroq, `+998` bilan yoki 9 xonali). */
  phone!: string;
}
