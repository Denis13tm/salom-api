import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SalomOperatorGuard } from "../orders/guards/salom-operator.guard";
import { SendChatMessageDto } from "./dto/send-chat-message.dto";
import { OperatorChatService } from "./operator-chat.service";

@Controller({ path: "operator/chat", version: "1" })
@UseGuards(SalomOperatorGuard)
export class OperatorChatApiController {
  constructor(private readonly chat: OperatorChatService) {}

  @Get("threads")
  threads() {
    return this.chat.listThreadsForOperator();
  }

  @Get("threads/:driverId/messages")
  async messages(@Param("driverId") driverId: string) {
    await this.chat.assertDriverExists(driverId);
    return this.chat.listMessagesForOperator(driverId);
  }

  @Post("threads/:driverId/messages")
  async send(
    @Req() req: Request & { salomOperatorId?: string },
    @Param("driverId") driverId: string,
    @Body() body: SendChatMessageDto,
  ) {
    await this.chat.assertDriverExists(driverId);
    return this.chat.sendAsOperator(req.salomOperatorId!, driverId, body.body);
  }
}
