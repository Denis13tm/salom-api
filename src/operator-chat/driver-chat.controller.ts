import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SalomDriverGuard } from '../tracking/guards/salom-driver.guard';
import { DriverSendChatDto } from './dto/driver-send-chat.dto';
import { MarkChatReadDto } from './dto/mark-chat-read.dto';
import { OperatorChatService } from './operator-chat.service';

@Controller({ path: 'drivers/me/chat', version: '1' })
@UseGuards(SalomDriverGuard)
export class DriverChatController {
  constructor(private readonly chat: OperatorChatService) {}

  @Get('messages')
  list(
    @Req() req: Request & { salomDriverId?: string },
    @Query('channel') channel?: string,
  ) {
    const ch = channel === 'admin' ? 'admin' : 'operator';
    return this.chat.listMessagesForDriver(req.salomDriverId!, ch);
  }

  @Get('unread')
  unread(@Req() req: Request & { salomDriverId?: string }) {
    return this.chat.getUnreadForDriver(req.salomDriverId!);
  }

  @Post('messages')
  send(@Req() req: Request & { salomDriverId?: string }, @Body() body: DriverSendChatDto) {
    const ch = body.channel === 'admin' ? 'admin' : 'operator';
    return this.chat.sendAsDriver(req.salomDriverId!, body.body, ch);
  }

  @Post('read')
  markRead(@Req() req: Request & { salomDriverId?: string }, @Body() body: MarkChatReadDto) {
    return this.chat.markDriverChannelRead(req.salomDriverId!, body.channel);
  }
}
