import { Type } from "class-transformer";
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from "class-validator";
import { PaymentType, FareMode } from "@prisma/client";

export class CreateOrderDto {
  @IsUUID("4")
  @IsNotEmpty()
  serviceZoneId!: string;

  @IsString()
  @IsNotEmpty()
  customerPhone!: string;

  @IsString()
  @IsNotEmpty()
  pickupLandmark!: string;

  /** Ixtiyoriy pickup nuqtasi (kelish zonasi tekshiruvi) */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pickupLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pickupLng?: number;

  @IsOptional()
  @IsString()
  dropoffText?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsEnum(PaymentType)
  paymentType: PaymentType = "CASH";

  @IsEnum(FareMode)
  /** Default: yagona taxometr (operator narx kiritmasin) */
  fareMode: FareMode = FareMode.METERED;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  operatorEnteredFareUzs?: number;

  /** Pilot: pickup radius/ring operator tomonidan tanlanishi mumkin; map nuqta bo‘lsa auto. */
  @IsOptional()
  @IsUUID("4")
  pricingRingId?: string;
}
