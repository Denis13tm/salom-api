import { IsIn } from "class-validator";

export class MarkChatReadDto {
  @IsIn(["operator", "admin"])
  channel!: "operator" | "admin";
}
