import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";

export class UpsertDriverXpOverrideDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50_000_000)
  xp!: number;
}
