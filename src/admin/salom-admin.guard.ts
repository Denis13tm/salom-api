import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

type JwtAdminPayload = { sub: string; role: string };

@Injectable()
export class SalomAdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      Request & { salomAdminId?: string; salomAdminUserId?: string }
    >();
    const bearer = this.parseBearer(req);
    if (bearer) {
      try {
        const payload = await this.jwt.verifyAsync<JwtAdminPayload>(bearer);
        if (payload.role !== 'admin') {
          throw new ForbiddenException('Not an admin access token');
        }
        const a = await this.prisma.admin.findUnique({
          where: { id: payload.sub },
          select: { id: true, userId: true },
        });
        if (!a) {
          throw new ForbiddenException('Unknown admin');
        }
        req.salomAdminId = a.id;
        req.salomAdminUserId = a.userId;
        return true;
      } catch (e) {
        if (e instanceof ForbiddenException) {
          throw e;
        }
        throw new UnauthorizedException('Invalid or expired token');
      }
    }
    const allow = this.config.get<string>('ALLOW_LEGACY_AUTH_HEADERS', 'false') === 'true';
    if (!allow) {
      throw new UnauthorizedException('Authorization Bearer required');
    }
    const raw = req.get('x-salom-admin-id');
    const id = raw?.trim();
    if (!id) {
      throw new UnauthorizedException('Missing X-Salom-Admin-Id or Bearer');
    }
    const a = await this.prisma.admin.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!a) {
      throw new ForbiddenException('Unknown admin');
    }
    req.salomAdminId = a.id;
    req.salomAdminUserId = a.userId;
    return true;
  }

  private parseBearer(req: Request): string | null {
    const a = req.get('authorization');
    if (!a || !a.toLowerCase().startsWith('bearer ')) {
      return null;
    }
    return a.slice(7).trim();
  }
}
