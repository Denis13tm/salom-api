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

type AdminJwtPayload = { sub: string; role: string; typ?: string };

@WebSocketGateway({
  namespace: 'admin',
  cors: { origin: true, credentials: true },
})
export class AdminGateway implements OnGatewayConnection {
  private readonly log = new Logger(AdminGateway.name);

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

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (token) {
      try {
        const p = await this.jwt.verifyAsync<AdminJwtPayload>(token);
        if (p.role !== 'admin') {
          this.log.debug(`ws admin: reject non-admin ${client.id}`);
          client.disconnect(true);
          return;
        }
        const a = await this.prisma.admin.findUnique({
          where: { id: p.sub },
          select: { id: true },
        });
        if (!a) {
          client.disconnect(true);
          return;
        }
        (client.data as { adminId?: string }).adminId = p.sub;
        this.log.debug(`ws admin jwt ${p.sub} ${client.id}`);
        return;
      } catch {
        this.log.debug(`ws admin: invalid token ${client.id}`);
        client.disconnect(true);
        return;
      }
    }
    if (!this.allowLegacy()) {
      this.log.debug(`ws admin: no token, legacy disallowed ${client.id}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { scope: 'chat' | 'all' },
  ) {
    const data = client.data as { adminId?: string };
    if (data.adminId) {
      if (body?.scope === 'chat') {
        void client.join('chat:admins');
        return { ok: true as const, room: 'chat:admins', mode: 'jwt' as const };
      }
      return { ok: false as const, error: 'invalid_join' as const };
    }
    if (!this.allowLegacy()) {
      return { ok: false as const, error: 'token_required' as const };
    }
    if (body?.scope === 'chat') {
      void client.join('chat:admins');
      return { ok: true as const, room: 'chat:admins', mode: 'legacy' as const };
    }
    return { ok: false as const, error: 'invalid_join' as const };
  }

  emitChatToAdmins(payload: unknown) {
    this.server.to('chat:admins').emit('chat:message', payload);
  }
}
