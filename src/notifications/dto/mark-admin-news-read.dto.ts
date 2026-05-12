import { ArrayNotEmpty, IsArray, IsUUID } from "class-validator";

export class MarkAdminNewsReadDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID("4", { each: true })
  broadcastIds!: string[];
}
