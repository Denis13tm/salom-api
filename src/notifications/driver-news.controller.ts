import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SalomDriverGuard } from '../tracking/guards/salom-driver.guard';
import { MarkAdminNewsReadDto } from './dto/mark-admin-news-read.dto';
import { DriverNewsService } from './driver-news.service';

@Controller({ path: 'drivers/me', version: '1' })
@UseGuards(SalomDriverGuard)
export class DriverNewsController {
  constructor(private readonly news: DriverNewsService) {}

  @Get('news/unread-count')
  unreadCount(@Req() req: Request) {
    return this.news.unreadCountForDriver(req.salomDriverId!);
  }

  @Post('news/read')
  @HttpCode(200)
  markRead(@Req() req: Request, @Body() body: MarkAdminNewsReadDto) {
    return this.news.markRead(req.salomDriverId!, body.broadcastIds);
  }

  /** Administrator yangiliklari ro‘yxati (`read` — badge uchun). */
  @Get('news')
  list(@Req() req: Request, @Query('take') take?: string) {
    const n = take ? parseInt(take, 10) : undefined;
    return this.news.listForDriver(req.salomDriverId!, Number.isFinite(n) ? n : undefined);
  }
}
