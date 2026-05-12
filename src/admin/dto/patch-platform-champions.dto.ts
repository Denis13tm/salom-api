import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class PatchPlatformChampionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  championsSeasonTitleUz?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  championsPrizeDescriptionUz?: string;

  @IsOptional()
  @IsString()
  @MaxLength(800)
  championsCadenceHintUz?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  championsPrizeUsd?: number;

  /** `{{DATE}}` yoki `{date}` — server chorak oxiri sanasini qo‘yadi. */
  @IsOptional()
  @IsString()
  @MaxLength(800)
  championsPeriodEndTemplateUz?: string;

  /** Banner fayl nomlari (serverda `var/champions-banners`), tartib karusel tartibi. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  championsHomeBannerPaths?: string[];

  /** Karusel avtomatik almashish (sekund), 3–60. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(60)
  championsHomeCarouselIntervalSec?: number;
}
