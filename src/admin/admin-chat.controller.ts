import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SendChatMessageDto } from '../operator-chat/dto/send-chat-message.dto';
import { OperatorChatService } from '../operator-chat/operator-chat.service';
import { SalomAdminGuard } from './salom-admin.guard';

@Controller({ path: 'admin/chat', version: '1' })
@UseGuards(SalomAdminGuard)
export class AdminChatController {
  constructor(private readonly chat: OperatorChatService) {}

  @Get('threads')
  threads() {
    return this.chat.listThreadsForAdmin();
  }

  @Get('threads/:driverId/messages')
  async messages(@Param('driverId') driverId: string) {
    await this.chat.assertDriverExists(driverId);
    return this.chat.listMessagesForAdminPanel(driverId);
  }

  @Post('threads/:driverId/messages')
  async send(
    @Req() req: Request & { salomAdminId?: string },
    @Param('driverId') driverId: string,
    @Body() body: SendChatMessageDto,
  ) {
    await this.chat.assertDriverExists(driverId);
    return this.chat.sendAsAdmin(req.salomAdminId!, driverId, body.body);
  }
}
