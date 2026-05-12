import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ChatMessageSender } from "@prisma/client";
import { AdminGateway } from "../tracking/admin.gateway";
import { DriverGateway } from "../driver-ws/driver.gateway";
import { PrismaService } from "../prisma/prisma.service";
import { OperatorGateway } from "../tracking/operator.gateway";
import { ChatChannel, ChatMessagePayloadV1 } from "./operator-chat-ws.types";

export type ChatMessageDto = {
  id: string;
  sender: ChatMessageSender;
  body: string;
  createdAt: string;
  operatorDisplayName: string | null;
  adminDisplayName: string | null;
};

@Injectable()
export class OperatorChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly driverGateway: DriverGateway,
    private readonly operatorGateway: OperatorGateway,
    private readonly adminGateway: AdminGateway,
  ) {}

  private async ensureOperatorThread(driverId: string) {
    const existing = await this.prisma.driverOperatorChatThread.findUnique({
      where: { driverId },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.driverOperatorChatThread.create({
      data: { driverId },
    });
  }

  private async ensureAdminThread(driverId: string) {
    const existing = await this.prisma.driverAdminChatThread.findUnique({
      where: { driverId },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.driverAdminChatThread.create({
      data: { driverId },
    });
  }

  async listMessagesForDriver(
    driverId: string,
    channel: ChatChannel = "operator",
    take = 80,
  ) {
    if (channel === "admin") {
      return this.listAdminMessagesForDriver(driverId, take);
    }
    const thread = await this.prisma.driverOperatorChatThread.findUnique({
      where: { driverId },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: Math.min(200, Math.max(1, take)),
          include: {
            operator: { select: { id: true, displayName: true } },
          },
        },
      },
    });
    if (!thread) {
      return {
        threadId: null as string | null,
        messages: [] as ChatMessageDto[],
      };
    }
    const chronological = [...thread.messages].reverse();
    return {
      threadId: thread.id,
      messages: chronological.map((m) => this.mapOperatorMsg(m)),
    };
  }

  private async listAdminMessagesForDriver(driverId: string, take: number) {
    const thread = await this.prisma.driverAdminChatThread.findUnique({
      where: { driverId },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: Math.min(200, Math.max(1, take)),
          include: {
            admin: {
              select: {
                title: true,
                user: { select: { phone: true } },
              },
            },
          },
        },
      },
    });
    if (!thread) {
      return {
        threadId: null as string | null,
        messages: [] as ChatMessageDto[],
      };
    }
    const chronological = [...thread.messages].reverse();
    return {
      threadId: thread.id,
      messages: chronological.map((m) => this.mapAdminMsg(m)),
    };
  }

  async sendAsDriver(
    driverId: string,
    body: string,
    channel: ChatChannel = "operator",
  ) {
    const text = body.trim();
    if (!text) {
      throw new BadRequestException("Bo‘sh xabar");
    }
    if (channel === "admin") {
      const t = await this.ensureAdminThread(driverId);
      const msg = await this.prisma.$transaction(async (tx) => {
        const m = await tx.driverAdminChatMessage.create({
          data: {
            threadId: t.id,
            sender: ChatMessageSender.DRIVER,
            body: text,
          },
          include: {
            admin: {
              select: {
                title: true,
                user: { select: { phone: true } },
              },
            },
          },
        });
        await tx.driverAdminChatThread.update({
          where: { id: t.id },
          data: { lastMessageAt: m.createdAt },
        });
        return m;
      });
      this.broadcastAdmin(t.id, driverId, this.mapAdminMsg(msg));
      return { message: this.mapAdminMsg(msg) };
    }
    const t = await this.ensureOperatorThread(driverId);
    const msg = await this.prisma.$transaction(async (tx) => {
      const m = await tx.driverOperatorChatMessage.create({
        data: {
          threadId: t.id,
          sender: ChatMessageSender.DRIVER,
          body: text,
        },
        include: {
          operator: { select: { id: true, displayName: true } },
        },
      });
      await tx.driverOperatorChatThread.update({
        where: { id: t.id },
        data: { lastMessageAt: m.createdAt },
      });
      return m;
    });
    this.broadcastOperator(t.id, driverId, this.mapOperatorMsg(msg));
    return { message: this.mapOperatorMsg(msg) };
  }

  async listThreadsForOperator() {
    const threads = await this.prisma.driverOperatorChatThread.findMany({
      where: { lastMessageAt: { not: null } },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
      include: {
        driver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            onboardingStatus: true,
            operationalStatus: true,
            user: { select: { phone: true } },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, createdAt: true, sender: true },
        },
      },
    });
    const items = threads.map((t) => {
      const last = t.messages[0];
      return {
        threadId: t.id,
        driverId: t.driverId,
        lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
        driver: {
          id: t.driver.id,
          phone: t.driver.user.phone,
          firstName: t.driver.firstName,
          lastName: t.driver.lastName,
          onboardingStatus: t.driver.onboardingStatus,
          operationalStatus: t.driver.operationalStatus,
        },
        lastMessage: last
          ? {
              bodyPreview:
                last.body.length > 120
                  ? `${last.body.slice(0, 117)}…`
                  : last.body,
              createdAt: last.createdAt.toISOString(),
              sender: last.sender,
            }
          : null,
      };
    });
    return { items };
  }

  async listThreadsForAdmin() {
    const threads = await this.prisma.driverAdminChatThread.findMany({
      where: { lastMessageAt: { not: null } },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
      include: {
        driver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            onboardingStatus: true,
            operationalStatus: true,
            user: { select: { phone: true } },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, createdAt: true, sender: true },
        },
      },
    });
    const items = threads.map((t) => {
      const last = t.messages[0];
      return {
        threadId: t.id,
        driverId: t.driverId,
        lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
        driver: {
          id: t.driver.id,
          phone: t.driver.user.phone,
          firstName: t.driver.firstName,
          lastName: t.driver.lastName,
          onboardingStatus: t.driver.onboardingStatus,
          operationalStatus: t.driver.operationalStatus,
        },
        lastMessage: last
          ? {
              bodyPreview:
                last.body.length > 120
                  ? `${last.body.slice(0, 117)}…`
                  : last.body,
              createdAt: last.createdAt.toISOString(),
              sender: last.sender,
            }
          : null,
      };
    });
    return { items };
  }

  async listMessagesForOperator(driverId: string, take = 80) {
    const thread = await this.prisma.driverOperatorChatThread.findUnique({
      where: { driverId },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: Math.min(200, Math.max(1, take)),
          include: {
            operator: { select: { id: true, displayName: true } },
          },
        },
      },
    });
    if (!thread) {
      return {
        threadId: null as string | null,
        driverId,
        messages: [] as ChatMessageDto[],
      };
    }
    const chronological = [...thread.messages].reverse();
    return {
      threadId: thread.id,
      driverId,
      messages: chronological.map((m) => this.mapOperatorMsg(m)),
    };
  }

  async listMessagesForAdminPanel(driverId: string, take = 80) {
    const thread = await this.prisma.driverAdminChatThread.findUnique({
      where: { driverId },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: Math.min(200, Math.max(1, take)),
          include: {
            admin: {
              select: {
                title: true,
                user: { select: { phone: true } },
              },
            },
          },
        },
      },
    });
    if (!thread) {
      return {
        threadId: null as string | null,
        driverId,
        messages: [] as ChatMessageDto[],
      };
    }
    const chronological = [...thread.messages].reverse();
    return {
      threadId: thread.id,
      driverId,
      messages: chronological.map((m) => this.mapAdminMsg(m)),
    };
  }

  async sendAsOperator(operatorId: string, driverId: string, body: string) {
    const text = body.trim();
    if (!text) {
      throw new BadRequestException("Bo‘sh xabar");
    }
    const t = await this.ensureOperatorThread(driverId);
    const msg = await this.prisma.$transaction(async (tx) => {
      const m = await tx.driverOperatorChatMessage.create({
        data: {
          threadId: t.id,
          sender: ChatMessageSender.OPERATOR,
          operatorId,
          body: text,
        },
        include: {
          operator: { select: { id: true, displayName: true } },
        },
      });
      await tx.driverOperatorChatThread.update({
        where: { id: t.id },
        data: { lastMessageAt: m.createdAt },
      });
      return m;
    });
    this.broadcastOperator(t.id, driverId, this.mapOperatorMsg(msg));
    return { message: this.mapOperatorMsg(msg) };
  }

  async sendAsAdmin(adminId: string, driverId: string, body: string) {
    const text = body.trim();
    if (!text) {
      throw new BadRequestException("Bo‘sh xabar");
    }
    const t = await this.ensureAdminThread(driverId);
    const msg = await this.prisma.$transaction(async (tx) => {
      const m = await tx.driverAdminChatMessage.create({
        data: {
          threadId: t.id,
          sender: ChatMessageSender.ADMIN,
          adminId,
          body: text,
        },
        include: {
          admin: {
            select: {
              title: true,
              user: { select: { phone: true } },
            },
          },
        },
      });
      await tx.driverAdminChatThread.update({
        where: { id: t.id },
        data: { lastMessageAt: m.createdAt },
      });
      return m;
    });
    this.broadcastAdmin(t.id, driverId, this.mapAdminMsg(msg));
    return { message: this.mapAdminMsg(msg) };
  }

  async assertDriverExists(driverId: string) {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true },
    });
    if (!d) {
      throw new NotFoundException("Haydovchi topilmadi");
    }
  }

  async getUnreadForDriver(driverId: string) {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        operatorChatLastReadAt: true,
        adminChatLastReadAt: true,
      },
    });
    if (!d) {
      throw new NotFoundException();
    }
    const opThread = await this.prisma.driverOperatorChatThread.findUnique({
      where: { driverId },
      select: { id: true },
    });
    const adThread = await this.prisma.driverAdminChatThread.findUnique({
      where: { driverId },
      select: { id: true },
    });
    const opCut = d.operatorChatLastReadAt;
    const adCut = d.adminChatLastReadAt;
    const operatorUnread = opThread
      ? await this.prisma.driverOperatorChatMessage.count({
          where: {
            threadId: opThread.id,
            sender: ChatMessageSender.OPERATOR,
            ...(opCut ? { createdAt: { gt: opCut } } : {}),
          },
        })
      : 0;
    const adminUnread = adThread
      ? await this.prisma.driverAdminChatMessage.count({
          where: {
            threadId: adThread.id,
            sender: ChatMessageSender.ADMIN,
            ...(adCut ? { createdAt: { gt: adCut } } : {}),
          },
        })
      : 0;
    return {
      operator: operatorUnread,
      admin: adminUnread,
      total: operatorUnread + adminUnread,
    };
  }

  async markDriverChannelRead(driverId: string, channel: ChatChannel) {
    const now = new Date();
    if (channel === "operator") {
      await this.prisma.driver.update({
        where: { id: driverId },
        data: { operatorChatLastReadAt: now },
      });
    } else {
      await this.prisma.driver.update({
        where: { id: driverId },
        data: { adminChatLastReadAt: now },
      });
    }
    return { ok: true as const };
  }

  private adminLabel(
    a: { title: string | null; user: { phone: string } } | null,
  ): string | null {
    if (!a) return null;
    const t = a.title?.trim();
    if (t) return t;
    const p = a.user.phone;
    if (p.length >= 4) return `…${p.slice(-4)}`;
    return "Administrator";
  }

  private mapOperatorMsg(m: {
    id: string;
    sender: ChatMessageSender;
    body: string;
    createdAt: Date;
    operator: { id: string; displayName: string } | null;
  }): ChatMessageDto {
    return {
      id: m.id,
      sender: m.sender,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      operatorDisplayName: m.operator?.displayName ?? null,
      adminDisplayName: null,
    };
  }

  private mapAdminMsg(m: {
    id: string;
    sender: ChatMessageSender;
    body: string;
    createdAt: Date;
    admin: {
      title: string | null;
      user: { phone: string };
    } | null;
  }): ChatMessageDto {
    return {
      id: m.id,
      sender: m.sender,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      operatorDisplayName: null,
      adminDisplayName: this.adminLabel(m.admin),
    };
  }

  private broadcastOperator(
    threadId: string,
    driverId: string,
    message: ChatMessageDto,
  ) {
    const payload: ChatMessagePayloadV1 = {
      v: 1,
      channel: "operator",
      driverId,
      threadId,
      message: {
        id: message.id,
        sender: message.sender,
        body: message.body,
        createdAt: message.createdAt,
        operatorDisplayName: message.operatorDisplayName,
        adminDisplayName: message.adminDisplayName,
      },
    };
    this.driverGateway.emitChatMessage(driverId, payload);
    this.operatorGateway.emitChatToOperators(payload);
  }

  private broadcastAdmin(
    threadId: string,
    driverId: string,
    message: ChatMessageDto,
  ) {
    const payload: ChatMessagePayloadV1 = {
      v: 1,
      channel: "admin",
      driverId,
      threadId,
      message: {
        id: message.id,
        sender: message.sender,
        body: message.body,
        createdAt: message.createdAt,
        operatorDisplayName: message.operatorDisplayName,
        adminDisplayName: message.adminDisplayName,
      },
    };
    this.driverGateway.emitChatMessage(driverId, payload);
    this.adminGateway.emitChatToAdmins(payload);
  }
}
