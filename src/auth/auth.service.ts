import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  DriverOnboardingStatus,
  UserAccountStatus,
  UserRole,
} from "@prisma/client";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as bcrypt from "bcrypt";
import { normalizePhoneUz } from "../driver-onboarding/phone.util";
import { PrismaService } from "../prisma/prisma.service";
import {
  DEV_ACTIVATION_12_PLACEHOLDER,
  DEV_SMS_OTP_PLACEHOLDER,
  isDevAuthBypassEnabled,
  isPilotFixedOtpEnabled,
} from "./dev-auth.constants";

const DRIVER_ROLE = "driver" as const;
const OPERATOR_ROLE = "operator" as const;
const ADMIN_ROLE = "admin" as const;

function hashRefreshToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

function newRefreshPlain(): string {
  return randomBytes(32).toString("base64url");
}

export type ExchangeAndRefreshResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresInSec: number;
  refreshExpiresInSec: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  health() {
    return { status: "auth_module_ready" as const };
  }

  authStatus() {
    const access = this.accessExpiresString();
    const refresh = this.config.get<string>("JWT_REFRESH_EXPIRES", "30d");
    const devAuthBypass = isDevAuthBypassEnabled(
      this.config.get<string | undefined>("NODE_ENV"),
      this.config.get<string | undefined>("DEV_AUTH_BYPASS"),
    );
    const smsMode = (
      this.config.get<string>("SMS_MODE") ?? "log"
    ).toLowerCase();
    const smsHttpUrl = this.config.get<string>("SMS_HTTP_URL")?.trim();
    /** `log` / `stub` — haqiqiy operator tarmog‘iga SMS ketmaydi. */
    const realSmsToPhone =
      smsMode === "eskiz" || (smsMode === "http" && Boolean(smsHttpUrl));
    const pilotFixedOtp = isPilotFixedOtpEnabled(
      this.config.get<string | undefined>("PILOT_OTP_FIXED_ENABLED"),
    );
    return {
      jwt: true as const,
      exchangeSecretRequired: Boolean(
        this.config.get<string>("SALOM_EXCHANGE_SECRET"),
      ),
      allowLegacyAuthHeaders:
        this.config.get<string>("ALLOW_LEGACY_AUTH_HEADERS", "false") ===
        "true",
      otpLoginEnabled:
        this.config.get<string>("OTP_LOGIN_ENABLED", "false") === "true",
      accessTokenDefault: access,
      refreshTokenDefault: refresh,
      refreshSessions: true as const,
      devAuthBypass,
      devSmsOtpPlaceholder:
        devAuthBypass && !realSmsToPhone ? DEV_SMS_OTP_PLACEHOLDER : null,
      devActivation12Placeholder: devAuthBypass
        ? DEV_ACTIVATION_12_PLACEHOLDER
        : null,
      adminWebPasswordConfigured: Boolean(
        this.config.get<string>("ADMIN_WEB_PASSWORD")?.trim(),
      ),
      /** `log` | `stub` | `http` | `eskiz` — operator SMS uchun `eskiz` (+ ESKIZ_*) yoki to‘ldirilgan `http` URL. */
      smsMode,
      realSmsToPhone,
      /** Eskizsiz pilot: OTP `4444`, SMS yo‘q (Render: PILOT_OTP_FIXED_ENABLED=true). */
      pilotFixedOtpEnabled: pilotFixedOtp,
      pilotFixedOtpCode: pilotFixedOtp ? DEV_SMS_OTP_PLACEHOLDER : null,
    };
  }

  private timingSafeAdminPassword(input: string, expected: string): boolean {
    const a = createHash("sha256").update(input, "utf8").digest();
    const b = createHash("sha256").update(expected, "utf8").digest();
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Brauzer admin panel: `ADMIN_WEB_PASSWORD` (Render env) bilan solishtiriladi.
   * Birinchi `Admin` yozuviga JWT beriladi.
   */
  async loginAdminWebPassword(
    password: string,
  ): Promise<ExchangeAndRefreshResponse & { adminId: string }> {
    const expected = this.config.get<string>("ADMIN_WEB_PASSWORD")?.trim();
    if (!expected) {
      throw new ForbiddenException(
        "ADMIN_WEB_PASSWORD sozlanmagan — API Environment (masalan Render) ga qo‘shing",
      );
    }
    if (!this.timingSafeAdminPassword(password, expected)) {
      throw new UnauthorizedException("Parol noto‘g‘ri");
    }
    const admin = await this.prisma.admin.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true },
    });
    if (!admin) {
      throw new NotFoundException(
        "Bazada admin yozuvi yo‘q — seed / migratsiya tekshiring",
      );
    }
    const tokens = await this.issueWithNewRefresh(
      admin.userId,
      ADMIN_ROLE,
      admin.id,
    );
    return { ...tokens, adminId: admin.id };
  }

  /** Operator web: telefon (E.164) + bcrypt parol. */
  async loginOperatorPassword(
    phoneRaw: string,
    password: string,
  ): Promise<ExchangeAndRefreshResponse & { operatorId: string }> {
    let phone: string;
    try {
      phone = normalizePhoneUz(phoneRaw);
    } catch {
      throw new BadRequestException("Telefon formati noto‘g‘ri");
    }
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { operator: { select: { id: true } } },
    });
    if (!user || user.role !== UserRole.OPERATOR || !user.operator) {
      throw new UnauthorizedException("Telefon yoki parol noto‘g‘ri");
    }
    if (user.status === UserAccountStatus.SUSPENDED) {
      throw new ForbiddenException("Hisob to‘xtatilgan");
    }
    if (!user.passwordHash) {
      throw new ForbiddenException(
        "Operator paroli o‘rnatilmagan — admin «Operatorlar» bo‘limida parol bering",
      );
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Telefon yoki parol noto‘g‘ri");
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const tokens = await this.issueWithNewRefresh(
      user.id,
      OPERATOR_ROLE,
      user.operator.id,
    );
    return { ...tokens, operatorId: user.operator.id };
  }

  private accessExpiresString(): string {
    return (
      this.config.get<string>("JWT_ACCESS_EXPIRES")?.trim() ||
      this.config.get<string>("JWT_EXPIRES", "7d")
    );
  }

  private assertExchangeSecret(provided: string | undefined) {
    const expected = this.config.get<string | undefined>(
      "SALOM_EXCHANGE_SECRET",
    );
    if (expected) {
      if (provided !== expected) {
        throw new UnauthorizedException("Invalid X-Salom-Exchange-Secret");
      }
      return;
    }
    if (this.config.get("NODE_ENV") === "production") {
      throw new ForbiddenException(
        "Set SALOM_EXCHANGE_SECRET for token exchange in production",
      );
    }
  }

  async exchangeDriverToken(
    driverId: string,
    exchangeSecret: string | undefined,
  ) {
    this.assertExchangeSecret(exchangeSecret);
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, activationCode: true, appActivatedAt: true },
    });
    if (!d) {
      throw new NotFoundException("Driver not found");
    }
    if (d.activationCode && !d.appActivatedAt) {
      throw new ForbiddenException(
        "Avval 12 xonali faollashtirish kodi (telefon) bilan tasdiqlang",
      );
    }
    return this.issueDriverTokensById(driverId);
  }

  /** Driver JWT + refresh (OTP yoki alohida tasdiqdan keyin). */
  async issueDriverTokensById(
    driverId: string,
  ): Promise<ExchangeAndRefreshResponse> {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, userId: true },
    });
    if (!d) {
      throw new NotFoundException("Driver not found");
    }
    return this.issueWithNewRefresh(d.userId, DRIVER_ROLE, d.id);
  }

  /**
   * Phase 19 — admin berilgan 12 xonali kod + telefon (ilovani rasmiy faollashtirish).
   * Dev: `111111111111` + `DEV_AUTH_BYPASS` — `activationCode` bo‘lmasa ham, tasdiqlangan ariza + telefon.
   */
  async activateDriverWithCode(
    phoneRaw: string,
    codeRaw: string,
  ): Promise<ExchangeAndRefreshResponse> {
    const expect = normalizePhoneUz(phoneRaw);
    const code = codeRaw.replace(/\D/g, "");
    if (code.length !== 12) {
      throw new BadRequestException(
        "Faollashtirish kodi 12 raqam bo‘lishi kerak",
      );
    }
    if (
      isDevAuthBypassEnabled(
        this.config.get<string | undefined>("NODE_ENV"),
        this.config.get<string | undefined>("DEV_AUTH_BYPASS"),
      ) &&
      code === DEV_ACTIVATION_12_PLACEHOLDER
    ) {
      return this.activateDriverWithDev12Placeholder(phoneRaw, expect);
    }
    const d = await this.prisma.driver.findFirst({
      where: { activationCode: code },
      include: { user: { select: { phone: true, status: true, role: true } } },
    });
    if (!d || d.user.role !== UserRole.DRIVER) {
      throw new UnauthorizedException("Kod yoki telefon noto‘g‘ri");
    }
    let actual: string;
    try {
      actual = normalizePhoneUz(d.user.phone);
    } catch {
      throw new UnauthorizedException("Kod yoki telefon noto‘g‘ri");
    }
    if (actual !== expect) {
      throw new UnauthorizedException("Kod yoki telefon noto‘g‘ri");
    }
    if (d.user.status === UserAccountStatus.SUSPENDED) {
      throw new ForbiddenException("Hisob to‘xtatilgan");
    }
    if (!d.activationCode) {
      throw new BadRequestException(
        "Aktivatsiya kodi talab etilmaydi (legacy hisob)",
      );
    }
    if (d.appActivatedAt) {
      return this.issueDriverTokensById(d.id);
    }
    await this.prisma.driver.update({
      where: { id: d.id },
      data: { appActivatedAt: new Date() },
    });
    return this.issueDriverTokensById(d.id);
  }

  /**
   * Dev: seed bo‘lmasa ham, `111111...` + telefon orqali lokal test — bazada ushbu `expect` E.164 bo‘yicha haydovchi avto-yaratiladi.
   * (Productionda shu tarmoqqa yo‘l yo‘q: `isDevAuthBypassEnabled` + placeholder faqat lokal/CI.)
   */
  private async findOrCreateDevDriverForPlaceholder(expect: string) {
    const existing = await this.prisma.user.findUnique({
      where: { phone: expect },
      include: { driver: { select: { id: true } } },
    });
    if (existing) {
      if (existing.role !== UserRole.DRIVER) {
        throw new UnauthorizedException(
          "Bu telefon boshqa roldan foydalanilmoqda (seed/dev)",
        );
      }
      if (existing.driver) {
        return this.prisma.driver.findFirstOrThrow({
          where: { id: existing.driver.id },
          include: {
            user: { select: { phone: true, status: true, role: true } },
          },
        });
      }
      const zone = await this.prisma.serviceZone.findFirst({
        where: { isActive: true },
        select: { id: true },
      });
      return this.prisma.driver.create({
        data: {
          userId: existing.id,
          serviceZoneId: zone?.id ?? undefined,
          onboardingStatus: DriverOnboardingStatus.APPROVED,
        },
        include: {
          user: { select: { phone: true, status: true, role: true } },
        },
      });
    }
    const zone = await this.prisma.serviceZone.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone: expect,
          role: UserRole.DRIVER,
          status: UserAccountStatus.ACTIVE,
        },
      });
      return tx.driver.create({
        data: {
          userId: user.id,
          serviceZoneId: zone?.id ?? undefined,
          onboardingStatus: DriverOnboardingStatus.APPROVED,
        },
        include: {
          user: { select: { phone: true, status: true, role: true } },
        },
      });
    });
  }

  /** Dev 12 xonali placeholder — telefon; lokal `APPROVED` shartisiz (prod yo‘l admin kodiga bog‘liq). */
  private async activateDriverWithDev12Placeholder(
    phoneRaw: string,
    expect: string,
  ): Promise<ExchangeAndRefreshResponse> {
    const t = phoneRaw.trim();
    const digits = t.replace(/\D/g, "");
    let d = await this.prisma.driver.findFirst({
      where: {
        user: {
          AND: [
            {
              OR: [
                { phone: t },
                { phone: expect },
                ...(digits ? [{ phone: digits }, { phone: `+${digits}` }] : []),
              ],
            },
            { role: UserRole.DRIVER },
            { status: { not: UserAccountStatus.SUSPENDED } },
          ],
        },
        onboardingStatus: { not: DriverOnboardingStatus.REJECTED },
      },
      include: { user: { select: { phone: true, status: true, role: true } } },
    });
    if (!d) {
      d = await this.findOrCreateDevDriverForPlaceholder(expect);
    }
    if (!d || d.user.role !== UserRole.DRIVER) {
      throw new UnauthorizedException("Kod yoki telefon noto‘g‘ri");
    }
    let actual: string;
    try {
      actual = normalizePhoneUz(d.user.phone);
    } catch {
      throw new UnauthorizedException("Kod yoki telefon noto‘g‘ri");
    }
    if (actual !== expect) {
      throw new UnauthorizedException("Kod yoki telefon noto‘g‘ri");
    }
    if (d.user.status === UserAccountStatus.SUSPENDED) {
      throw new ForbiddenException("Hisob to‘xtatilgan");
    }
    if (d.appActivatedAt) {
      return this.issueDriverTokensById(d.id);
    }
    await this.prisma.driver.update({
      where: { id: d.id },
      data: { appActivatedAt: new Date() },
    });
    return this.issueDriverTokensById(d.id);
  }

  async exchangeOperatorToken(
    operatorId: string,
    exchangeSecret: string | undefined,
  ) {
    this.assertExchangeSecret(exchangeSecret);
    const o = await this.prisma.operator.findUnique({
      where: { id: operatorId },
      select: { id: true, userId: true },
    });
    if (!o) {
      throw new NotFoundException("Operator not found");
    }
    return this.issueWithNewRefresh(o.userId, OPERATOR_ROLE, o.id);
  }

  async exchangeAdminToken(
    adminId: string,
    exchangeSecret: string | undefined,
  ) {
    this.assertExchangeSecret(exchangeSecret);
    const a = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, userId: true },
    });
    if (!a) {
      throw new NotFoundException("Admin not found");
    }
    return this.issueWithNewRefresh(a.userId, ADMIN_ROLE, a.id);
  }

  async refreshTokens(
    refreshTokenPlain: string,
  ): Promise<ExchangeAndRefreshResponse> {
    const tokenHash = hashRefreshToken(refreshTokenPlain);
    const row = await this.prisma.authRefreshSession.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!row) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
    const role = row.role;
    if (role !== DRIVER_ROLE && role !== OPERATOR_ROLE && role !== ADMIN_ROLE) {
      throw new UnauthorizedException();
    }
    await this.prisma.authRefreshSession.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    return this.issueWithNewRefresh(row.userId, role, row.subjectId);
  }

  async logoutWithRefreshToken(
    refreshTokenPlain: string,
  ): Promise<{ ok: true }> {
    const tokenHash = hashRefreshToken(refreshTokenPlain);
    const row = await this.prisma.authRefreshSession.findFirst({
      where: { tokenHash, revokedAt: null },
    });
    if (row) {
      await this.prisma.authRefreshSession.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  }

  async logoutAllSessions(
    authorizationHeader: string | undefined,
  ): Promise<{ ok: true; revoked: number }> {
    const bearer = this.parseBearerHeader(authorizationHeader);
    if (!bearer) {
      throw new UnauthorizedException("Authorization Bearer required");
    }
    type AccessPayload = { sub: string; role: string; typ?: string };
    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(bearer);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    if (payload.typ && payload.typ !== "access") {
      throw new UnauthorizedException("Access token required");
    }
    if (
      payload.role !== DRIVER_ROLE &&
      payload.role !== OPERATOR_ROLE &&
      payload.role !== ADMIN_ROLE
    ) {
      throw new ForbiddenException();
    }
    const userId = await this.resolveUserId(payload.role, payload.sub);
    if (!userId) {
      throw new ForbiddenException("Unknown subject");
    }
    const res = await this.prisma.authRefreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true, revoked: res.count };
  }

  private parseBearerHeader(h: string | undefined): string | null {
    if (!h || !h.toLowerCase().startsWith("bearer ")) {
      return null;
    }
    return h.slice(7).trim();
  }

  private async resolveUserId(
    role: string,
    subjectId: string,
  ): Promise<string | null> {
    if (role === DRIVER_ROLE) {
      const d = await this.prisma.driver.findUnique({
        where: { id: subjectId },
        select: { userId: true },
      });
      return d?.userId ?? null;
    }
    if (role === OPERATOR_ROLE) {
      const o = await this.prisma.operator.findUnique({
        where: { id: subjectId },
        select: { userId: true },
      });
      return o?.userId ?? null;
    }
    if (role === ADMIN_ROLE) {
      const a = await this.prisma.admin.findUnique({
        where: { id: subjectId },
        select: { userId: true },
      });
      return a?.userId ?? null;
    }
    return null;
  }

  private async issueWithNewRefresh(
    userId: string,
    role: typeof DRIVER_ROLE | typeof OPERATOR_ROLE | typeof ADMIN_ROLE,
    subjectId: string,
  ): Promise<ExchangeAndRefreshResponse> {
    const { plain, refreshExpiresInSec } = await this.createRefreshSession(
      userId,
      subjectId,
      role,
    );
    const access = this.signAccess(role, subjectId);
    return {
      accessToken: access.accessToken,
      refreshToken: plain,
      tokenType: access.tokenType,
      expiresInSec: access.expiresInSec,
      refreshExpiresInSec,
    };
  }

  private async createRefreshSession(
    userId: string,
    subjectId: string,
    role: string,
  ): Promise<{ plain: string; refreshExpiresInSec: number }> {
    const plain = newRefreshPlain();
    const tokenHash = hashRefreshToken(plain);
    const expiresAt = this.refreshExpiresAtDate();
    await this.prisma.authRefreshSession.create({
      data: { userId, subjectId, role, tokenHash, expiresAt },
    });
    const refreshExpiresInSec = Math.max(
      60,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    );
    return { plain, refreshExpiresInSec };
  }

  private refreshExpiresAtDate(): Date {
    const exp = this.config.get<string>("JWT_REFRESH_EXPIRES", "30d");
    return new Date(Date.now() + this.approxSeconds(exp) * 1000);
  }

  private signAccess(
    role: typeof DRIVER_ROLE | typeof OPERATOR_ROLE | typeof ADMIN_ROLE,
    sub: string,
  ): { accessToken: string; tokenType: "Bearer"; expiresInSec: number } {
    const expiresIn = this.accessExpiresString();
    const accessToken = this.jwt.sign({ sub, role, typ: "access" }, {
      expiresIn,
    } as import("@nestjs/jwt").JwtSignOptions);
    return {
      accessToken,
      tokenType: "Bearer",
      expiresInSec: this.approxSeconds(expiresIn),
    };
  }

  private approxSeconds(exp: string): number {
    const m = exp.match(/^(\d+)([smhd])$/i);
    if (!m) return 7 * 24 * 3600;
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    if (u === "s") return n;
    if (u === "m") return n * 60;
    if (u === "h") return n * 3600;
    if (u === "d") return n * 86400;
    return 7 * 24 * 3600;
  }
}
