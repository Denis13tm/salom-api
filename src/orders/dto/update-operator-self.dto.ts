import { IsString, MaxLength } from "class-validator";

export class UpdateOperatorSelfDto {
  @IsString()
  @MaxLength(32)
  phone!: string;
}
