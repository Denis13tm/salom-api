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
import { PrismaService } from '../../prisma/prisma.service';

type JwtOpPayload = { sub: string; role: string };

@Injectable()
export class SalomOperatorGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { salomOperatorId?: string }>();
    const bearer = this.parseBearer(req);
    if (bearer) {
      try {
        const payload = await this.jwt.verifyAsync<JwtOpPayload>(bearer);
        if (payload.role !== 'operator') {
          throw new ForbiddenException('Not an operator access token');
        }
        const op = await this.prisma.operator.findUnique({
          where: { id: payload.sub },
          select: { id: true, user: { select: { status: true } } },
        });
        if (!op) {
          throw new ForbiddenException('Unknown operator');
        }
        if (op.user.status !== 'ACTIVE') {
          throw new ForbiddenException('Operator account is not active');
        }
        req.salomOperatorId = op.id;
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
    const raw = req.get('x-salom-operator-id');
    const id = raw?.trim();
    if (!id) {
      throw new UnauthorizedException('Missing X-Salom-Operator-Id or Bearer');
    }
    const op = await this.prisma.operator.findUnique({
      where: { id },
      select: { id: true, user: { select: { status: true } } },
    });
    if (!op) {
      throw new ForbiddenException('Unknown operator');
    }
    if (op.user.status !== 'ACTIVE') {
      throw new ForbiddenException('Operator account is not active');
    }
    req.salomOperatorId = id;
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
