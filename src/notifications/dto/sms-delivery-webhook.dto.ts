import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";

/** Provayder `POST /api/v1/webhooks/sms/delivery` — `X-Salom-Sms-Secret`. */
export class SmsDeliveryWebhookDto {
  @IsUUID()
  logId!: string;

  @IsString()
  @IsIn(["DELIVERED", "FAILED", "SENT"])
  status!: "DELIVERED" | "FAILED" | "SENT";

  @IsOptional()
  @IsString()
  error?: string;
}
