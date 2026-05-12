import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
}
