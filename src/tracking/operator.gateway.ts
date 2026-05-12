import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { PrismaService } from "../prisma/prisma.service";
import { LastDriverLocation } from "./last-known.store";

type OpJwtPayload = { sub: string; role: string; typ?: string };

@WebSocketGateway({
  namespace: "operator",
  cors: { origin: true, credentials: true },
})
export class OperatorGateway implements OnGatewayConnection {
  private readonly log = new Logger(OperatorGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private allowLegacy() {
    return (
      this.config.get<string>("ALLOW_LEGACY_AUTH_HEADERS", "false") === "true"
    );
  }

  private extractToken(client: Socket): string | null {
    const h =
      client.handshake.headers["authorization"] ??
      client.handshake.headers["Authorization"];
    if (typeof h === "string" && h.toLowerCase().startsWith("bearer ")) {
      return h.slice(7).trim();
    }
    const auth = client.handshake.auth;
    if (auth && typeof auth === "object" && "token" in auth) {
      const t = (auth as { token?: string }).token;
      if (typeof t === "string" && t.length > 0) return t;
    }
    return null;
  }

  /**
   * Phase 12: JWT (operator) yoki legacy ochiq ulanish.
   * `ALLOW_LEGACY_AUTH_HEADERS=false` bo‘lsa token majburiy.
   */
  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (token) {
      try {
        const p = await this.jwt.verifyAsync<OpJwtPayload>(token);
        if (p.role !== "operator") {
          this.log.debug(`ws operator: reject non-operator ${client.id}`);
          client.disconnect(true);
          return;
        }
        const op = await this.prisma.operator.findUnique({
          where: { id: p.sub },
          select: { id: true, serviceZoneId: true },
        });
        if (!op) {
          client.disconnect(true);
          return;
        }
        (
          client.data as { operatorId?: string; serviceZoneId?: string | null }
        ).operatorId = p.sub;
        (
          client.data as { operatorId?: string; serviceZoneId?: string | null }
        ).serviceZoneId = op.serviceZoneId;
        this.log.debug(`ws operator jwt ${p.sub} ${client.id}`);
        return;
      } catch {
        this.log.debug(`ws operator: invalid token ${client.id}`);
        client.disconnect(true);
        return;
      }
    }
    if (!this.allowLegacy()) {
      this.log.debug(`ws operator: no token, legacy disallowed ${client.id}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage("join")
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { scope: "zone" | "all" | "chat"; serviceZoneId?: string },
  ) {
    const data = client.data as {
      operatorId?: string;
      serviceZoneId?: string | null;
    };
    if (data.operatorId) {
      if (body?.scope === "chat") {
        void client.join("chat:ops");
        return { ok: true, room: "chat:ops", mode: "jwt" as const };
      }
      if (body?.scope === "all") {
        void client.join("all");
        return { ok: true, room: "all", mode: "jwt" as const };
      }
      if (body?.scope === "zone" && body.serviceZoneId) {
        const z = data.serviceZoneId;
        if (z && z !== body.serviceZoneId) {
          return { ok: false, error: "zone_mismatch" as const };
        }
        void client.join(`zone:${body.serviceZoneId}`);
        return {
          ok: true,
          room: `zone:${body.serviceZoneId}`,
          mode: "jwt" as const,
        };
      }
      return { ok: false, error: "invalid_join" as const };
    }
    if (!this.allowLegacy()) {
      return { ok: false, error: "token_required" as const };
    }
    if (body?.scope === "chat") {
      void client.join("chat:ops");
      return { ok: true, room: "chat:ops", mode: "legacy" as const };
    }
    if (body?.scope === "all") {
      void client.join("all");
      return { ok: true, room: "all", mode: "legacy" as const };
    }
    if (body?.scope === "zone" && body.serviceZoneId) {
      void client.join(`zone:${body.serviceZoneId}`);
      return {
        ok: true,
        room: `zone:${body.serviceZoneId}`,
        mode: "legacy" as const,
      };
    }
    return { ok: false, error: "invalid_join" as const };
  }

  emitOrderUpdate(serviceZoneId: string | null, payload: unknown) {
    if (serviceZoneId) {
      this.server.to(`zone:${serviceZoneId}`).emit("order:update", payload);
    } else {
      this.server.to("all").emit("order:update", payload);
    }
  }

  emitDriverLocation(snap: LastDriverLocation) {
    const payload = {
      driverId: snap.driverId,
      serviceZoneId: snap.serviceZoneId,
      lat: snap.lat,
      lng: snap.lng,
      recordedAt: snap.recordedAt,
      accuracyM: snap.accuracyM,
      speedKmh: snap.speedKmh,
    };
    if (snap.serviceZoneId) {
      this.server
        .to(`zone:${snap.serviceZoneId}`)
        .emit("driver:location", payload);
    } else {
      this.server.to("all").emit("driver:location", payload);
    }
  }

  /** Barcha `join({ scope: 'chat' })` qilgan operatorlar — jadval va ochiq thread. */
  emitChatToOperators(payload: unknown) {
    this.server.to("chat:ops").emit("chat:message", payload);
  }
}
