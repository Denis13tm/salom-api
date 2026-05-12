import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SalomDriverGuard } from '../tracking/guards/salom-driver.guard';
import { LedgerService } from './ledger.service';

@Controller({ path: 'drivers/me', version: '1' })
@UseGuards(SalomDriverGuard)
export class DriverLedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('balance')
  balance(@Req() req: Request) {
    return this.ledger.getDriverBalance(req.salomDriverId!);
  }

  @Get('earnings')
  earnings(@Req() req: Request, @Query('limit') limit?: string) {
    const n = limit ? Math.min(100, Math.max(1, parseInt(limit, 10) || 30)) : 30;
    return this.ledger.listEarningsForDriver(req.salomDriverId!, n);
  }

  @Get('finance-summary')
  financeSummary(@Req() req: Request, @Query('days') days?: string) {
    const w = days ? Math.min(90, Math.max(1, parseInt(days, 10) || 30)) : 30;
    return this.ledger.getDriverFinanceSummary(req.salomDriverId!, w);
  }
}
