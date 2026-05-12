import { IsIn, IsInt, IsOptional, Min, ValidateIf } from "class-validator";

export class ResolveDisputeDto {
  @IsIn(["cancel", "complete"])
  outcome!: "cancel" | "complete";

  @IsOptional()
  @ValidateIf((o: ResolveDisputeDto) => o.outcome === "complete")
  @IsInt()
  @Min(0)
  /** outcome=complete: yo‘lovchi bortda edi (operator narx yopadi). */
  fareUzs?: number;
}
