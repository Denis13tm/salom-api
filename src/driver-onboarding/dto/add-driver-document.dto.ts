import { IsEnum, IsString, MinLength, MaxLength } from "class-validator";
import { DriverDocumentType } from "@prisma/client";

export class AddDriverDocumentDto {
  @IsEnum(DriverDocumentType)
  type!: DriverDocumentType;

  @IsString()
  @MinLength(4)
  @MaxLength(500)
  storageKey!: string;
}
