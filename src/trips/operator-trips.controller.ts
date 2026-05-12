import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ResolveDisputeDto } from "../orders/dto/resolve-dispute.dto";
import { SalomOperatorGuard } from "../orders/guards/salom-operator.guard";
import { TripsService } from "./trips.service";

@Controller({ path: "operator/trips", version: "1" })
@UseGuards(SalomOperatorGuard)
export class OperatorTripsController {
  constructor(private readonly trips: TripsService) {}

  /** Ochiq nizolar — ixtiyoriy zona filtri */
  @Get("disputed")
  listDisputed(@Query("serviceZoneId") serviceZoneId?: string) {
    return this.trips.listDisputedForOperator(serviceZoneId);
  }

  @Post(":tripId/dispute/resolve")
  resolve(
    @Param("tripId") tripId: string,
    @Req() req: Request,
    @Body() body: ResolveDisputeDto,
  ) {
    return this.trips.resolveDispute(tripId, req.salomOperatorId!, body);
  }
}
