import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateServiceZoneDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** URL/xarita uchun: `gallaorol`, `guliston-demo` */
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug: faqat kichik harf, raqam va tire (masalan: gallaorol yoki navoiy-shahar)',
  })
  slug!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLng?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
