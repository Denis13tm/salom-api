import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";

type JwtDriverPayload = { sub: string; role: string; typ?: string };

@Injectable()
export class SalomDriverGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { salomDriverId?: string }>();
    const bearer = this.parseBearer(req);
    if (bearer) {
      try {
        const payload = await this.jwt.verifyAsync<JwtDriverPayload>(bearer);
        if (payload.role !== "driver") {
          throw new ForbiddenException("Not a driver access token");
        }
        const driver = await this.prisma.driver.findUnique({
          where: { id: payload.sub },
          select: { id: true },
        });
        if (!driver) {
          throw new ForbiddenException("Unknown driver");
        }
        req.salomDriverId = driver.id;
        return true;
      } catch (e) {
        if (e instanceof ForbiddenException) {
          throw e;
        }
        throw new UnauthorizedException("Invalid or expired token");
      }
    }
    const allow =
      this.config.get<string>("ALLOW_LEGACY_AUTH_HEADERS", "false") === "true";
    if (!allow) {
      throw new UnauthorizedException("Authorization Bearer required");
    }
    const rawUnknown = req.get("x-salom-driver-id") as unknown;
    const idRaw: unknown = Array.isArray(rawUnknown)
      ? rawUnknown[0]
      : rawUnknown;
    const id = typeof idRaw === "string" ? idRaw.trim() : "";
    if (!id) {
      throw new UnauthorizedException("Missing X-Salom-Driver-Id or Bearer");
    }
    const driver = await this.prisma.driver.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!driver) {
      throw new ForbiddenException("Unknown driver");
    }
    req.salomDriverId = id;
    return true;
  }

  private parseBearer(req: Request): string | null {
    const a = req.get("authorization");
    if (!a || !a.toLowerCase().startsWith("bearer ")) {
      return null;
    }
    return a.slice(7).trim();
  }
}
