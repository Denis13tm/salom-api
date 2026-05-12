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
import { OpenDisputeDto } from "../orders/dto/open-dispute.dto";
import { SalomDriverGuard } from "../tracking/guards/salom-driver.guard";
import { SalomDriverOperationalGuard } from "../tracking/guards/salom-driver-operational.guard";
import { CompleteTripDto } from "./dto/complete-trip.dto";
import { TripsService } from "./trips.service";

@Controller({ path: "drivers/me/trips", version: "1" })
@UseGuards(SalomDriverGuard)
export class DriverTripsController {
  constructor(private readonly trips: TripsService) {}

  @Get("active")
  @UseGuards(SalomDriverOperationalGuard)
  active(@Req() req: Request) {
    return this.trips.getActiveForDriver(req.salomDriverId!);
  }

  @Get("history")
  history(@Req() req: Request, @Query("limit") limit?: string) {
    const n = limit ? parseInt(limit, 10) : 20;
    return this.trips.listHistoryForDriver(
      req.salomDriverId!,
      Number.isNaN(n) ? 20 : n,
    );
  }

  @Post(":tripId/pickup-arrived")
  @UseGuards(SalomDriverOperationalGuard)
  pickupArrived(@Param("tripId") tripId: string, @Req() req: Request) {
    return this.trips.markPickupArrived(tripId, req.salomDriverId!);
  }

  @Post(":tripId/start")
  @UseGuards(SalomDriverOperationalGuard)
  start(@Param("tripId") tripId: string, @Req() req: Request) {
    return this.trips.startTrip(tripId, req.salomDriverId!);
  }

  @Post(":tripId/complete")
  @UseGuards(SalomDriverOperationalGuard)
  complete(
    @Param("tripId") tripId: string,
    @Req() req: Request,
    @Body() body: CompleteTripDto,
  ) {
    return this.trips.completeTrip(tripId, req.salomDriverId!, body);
  }

  @Post(":tripId/dispute")
  @UseGuards(SalomDriverOperationalGuard)
  dispute(
    @Param("tripId") tripId: string,
    @Req() req: Request,
    @Body() body: OpenDisputeDto,
  ) {
    return this.trips.openDispute(tripId, req.salomDriverId!, body);
  }
}
