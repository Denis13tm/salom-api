import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { IngestPingsBodyDto } from "./dto/ingest-pings.dto";
import { SalomDriverGuard } from "./guards/salom-driver.guard";
import { SalomDriverOperationalGuard } from "./guards/salom-driver-operational.guard";
import { TrackingService } from "./tracking.service";

@Controller({ path: "tracking", version: "1" })
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post("pings")
  @UseGuards(SalomDriverGuard, SalomDriverOperationalGuard)
  ingest(@Req() req: Request, @Body() body: IngestPingsBodyDto) {
    const driverId = req.salomDriverId!;
    return this.tracking.ingestPings(driverId, body);
  }

  @Get("snapshots/:serviceZoneId")
  getSnapshot(
    @Param("serviceZoneId") serviceZoneId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    this.tracking.assertSnapshotAccess(headers);
    return this.tracking.getZoneSnapshot(serviceZoneId);
  }
}
