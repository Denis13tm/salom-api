import type { Request } from "express";
import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { SalomDriverGuard } from "../tracking/guards/salom-driver.guard";
import { GamificationService } from "./gamification.service";

@Controller({ path: "drivers/me/champions", version: "1" })
@UseGuards(SalomDriverGuard)
export class DriverChampionsController {
  constructor(private readonly gamification: GamificationService) {}

  /** Oylik ro‘yxat sahifasi (offset/limit). `@Get()` dan oldin turishi kerak. */
  @Get("monthly-leaderboard")
  monthlyLeaderboard(
    @Req() req: Request & { salomDriverId?: string },
    @Query("offset") offsetStr?: string,
    @Query("limit") limitStr?: string,
  ) {
    const o = parseInt(offsetStr ?? "0", 10);
    const l = parseInt(limitStr ?? "10", 10);
    return this.gamification.getMonthlyLeaderboardPage(
      req.salomDriverId!,
      Number.isFinite(o) ? o : 0,
      Number.isFinite(l) ? l : 10,
    );
  }

  @Get()
  champions(
    @Req() req: Request & { salomDriverId?: string },
    @Query("periodYm") periodYm?: string,
  ) {
    return this.gamification.getChampionsSnapshot(req.salomDriverId!, periodYm);
  }
}
