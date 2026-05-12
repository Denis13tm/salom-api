import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import type { DriverNoticeWsPayloadV1 } from './driver-notice-payload';

type DriverJwtPayload = { sub: string; role: string; typ?: string };

@WebSocketGateway({
  namespace: 'driver',
  cors: { origin: true, credentials: true },
})
export class DriverGateway implements OnGatewayConnection {
  private readonly log = new Logger(DriverGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private allowLegacy() {
    return this.config.get<string>('ALLOW_LEGACY_AUTH_HEADERS', 'false') === 'true';
  }

  private extractToken(client: Socket): string | null {
    const h = client.handshake.headers['authorization'] ?? client.handshake.headers['Authorization'];
    if (typeof h === 'string' && h.toLowerCase().startsWith('bearer ')) {
      return h.slice(7).trim();
    }
    const auth = client.handshake.auth;
    if (auth && typeof auth === 'object' && 'token' in auth) {
      const t = (auth as { token?: string }).token;
      if (typeof t === 'string' && t.length > 0) return t;
    }
    return null;
  }

  /**
   * JWT: `Authorization: Bearer` (handshake) yoki `auth: { token }` — `driver:{id}` xonasiga avto-join.
   * Legacy: `ALLOW_LEGACY_AUTH_HEADERS=true` bo‘lganda soket ochiq, keyin `join` xabari.
   */
  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (token) {
      try {
        const p = await this.jwt.verifyAsync<DriverJwtPayload>(token);
        if (p.role !== 'driver') {
          this.log.debug(`ws: reject non-driver ${client.id}`);
          client.disconnect(true);
          return;
        }
        const d = await this.prisma.driver.findUnique({ where: { id: p.sub }, select: { id: true } });
        if (!d) {
          client.disconnect(true);
          return;
        }
        (client.data as { driverId?: string }).driverId = p.sub;
        void client.join(`driver:${p.sub}`);
        this.log.debug(`ws driver join jwt ${p.sub} ${client.id}`);
        return;
      } catch {
        this.log.debug(`ws: invalid token ${client.id}`);
        client.disconnect(true);
        return;
      }
    }
    if (!this.allowLegacy()) {
      this.log.debug(`ws: no token, legacy disallowed ${client.id}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { driverId: string },
  ) {
    const data = client.data as { driverId?: string };
    if (data.driverId) {
      if (body?.driverId && body.driverId !== data.driverId) {
        return { ok: false, error: 'driverId_mismatch' as const };
      }
      return { ok: true as const, room: `driver:${data.driverId}`, mode: 'jwt' as const };
    }
    if (!this.allowLegacy()) {
      return { ok: false, error: 'token_required' as const };
    }
    if (!body?.driverId) {
      return { ok: false, error: 'driverId_required' as const };
    }
    const d = await this.prisma.driver.findUnique({ where: { id: body.driverId }, select: { id: true } });
    if (!d) {
      return { ok: false, error: 'unknown_driver' as const };
    }
    void client.join(`driver:${body.driverId}`);
    return { ok: true as const, room: `driver:${body.driverId}`, mode: 'legacy' as const };
  }

  /** Haydovchiga yangi buyurtma taklifi. */
  emitOrderOffered(driverId: string, payload: unknown) {
    this.server.to(`driver:${driverId}`).emit('order:offered', payload);
  }

  emitOrderCancelled(driverId: string, payload: unknown) {
    this.server.to(`driver:${driverId}`).emit('order:cancelled', payload);
  }

  /** Operator ↔ haydovchi chat (namespace `/driver`, xona `driver:{id}`). */
  emitChatMessage(driverId: string, payload: unknown) {
    this.server.to(`driver:${driverId}`).emit('chat:message', payload);
  }

  /** Administrator tomonidan akkaunt/ariza oʻzgarganda haydovchiga jonli bildirishnomalar. */
  emitDriverNotice(driverId: string, payload: DriverNoticeWsPayloadV1) {
    this.server.to(`driver:${driverId}`).emit('driver:notice', payload);
  }
}
