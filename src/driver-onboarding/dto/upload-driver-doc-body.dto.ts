import { IsEnum } from 'class-validator';
import { DriverDocumentType } from '@prisma/client';

export class UploadDriverDocBodyDto {
  @IsEnum(DriverDocumentType)
  type!: DriverDocumentType;
}
