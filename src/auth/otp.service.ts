import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DriverOnboardingStatus,
  UserAccountStatus,
  UserRole,
} from "@prisma/client";
import { createHash, randomInt } from "node:crypto";
import { SmsService } from "../notifications/sms.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";
import type { ExchangeAndRefreshResponse } from "./auth.service";
import {
  DEV_SMS_OTP_PLACEHOLDER,
  isDevAuthBypassEnabled,
  isPilotFixedOtpEnabled,
} from "./dev-auth.constants";

/**
 * Telefon orqali bir martalik kod (pilot) — `OTP_LOGIN_ENABLED=true`.
 * Production: `OTP_PEPPER` tavsiya etiladi.
 */
@Injectable()
export class OtpService {
  private readonly log = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly auth: AuthService,
  ) {}

  private hashCode(driverId: string, plain: string): string {
    const pepper = this.config.get<string>("OTP_PEPPER", "salom-otp-dev");
    return createHash("sha256")
      .update(`${driverId}:${plain}:${pepper}`, "utf8")
      .digest("hex");
  }

  private ttlMs(): number {
    const m = this.config.get<number>("OTP_TTL_MINUTES", 10);
    return Math.max(1, Math.min(60, m)) * 60_000;
  }

  isEnabled(): boolean {
    return this.config.get<string>("OTP_LOGIN_ENABLED", "false") === "true";
  }

  private devAuthBypass(): boolean {
    return isDevAuthBypassEnabled(
      this.config.get<string | undefined>("NODE_ENV"),
      this.config.get<string | undefined>("DEV_AUTH_BYPASS"),
    );
  }

  /** Eskizsiz pilot: `4444`, SMS yo‘q (Render: PILOT_OTP_FIXED_ENABLED=true). */
  private pilotFixedOtp(): boolean {
    return isPilotFixedOtpEnabled(
      this.config.get<string | undefined>("PILOT_OTP_FIXED_ENABLED"),
    );
  }

  private realSmsMode(): boolean {
    const mode = (this.config.get<string>("SMS_MODE") ?? "log").toLowerCase();
    const httpUrl = this.config.get<string>("SMS_HTTP_URL")?.trim();
    return mode === "eskiz" || (mode === "http" && Boolean(httpUrl));
  }

  private usePlaceholderOtpCode(): boolean {
    return (
      this.pilotFixedOtp() || (this.devAuthBypass() && !this.realSmsMode())
    );
  }

  private async findDriverIdByPhone(phoneRaw: string): Promise<string | null> {
    const t = phoneRaw.trim();
    const digits = t.replace(/\D/g, "");
    const u = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone: t },
          ...(digits ? [{ phone: digits }, { phone: `+${digits}` }] : []),
        ],
        role: UserRole.DRIVER,
        driver: { isNot: null },
      },
      select: { id: true, driver: { select: { id: true } } },
    });
    return u?.driver?.id ?? null;
  }

  async requestDriverOtp(phone: string) {
    if (!this.isEnabled()) {
      throw new ForbiddenException(
        "OTP login o‘chirilgan (OTP_LOGIN_ENABLED=false)",
      );
    }
    const driverId = await this.findDriverIdByPhone(phone);
    if (!driverId) {
      throw new NotFoundException("Ushbu raqam bilan haydovchi topilmadi");
    }
    const code = this.usePlaceholderOtpCode()
      ? DEV_SMS_OTP_PLACEHOLDER
      : String(100_000 + randomInt(0, 900_000));
    const codeHash = this.hashCode(driverId, code);
    const expiresAt = new Date(Date.now() + this.ttlMs());
    const row = await this.prisma.otpLoginChallenge.create({
      data: {
        phoneNorm: phone.replace(/\D/g, "") || phone,
        codeHash,
        driverId,
        expiresAt,
      },
    });
    if (!this.pilotFixedOtp()) {
      const body = `Salom Taxi: kirish kodi — ${code}. Hech kimga bermang.`;
      const p = phone.trim();
      const dial = p.match(/^\+/) ? p : `+${p.replace(/\D/g, "")}`;
      await this.sms.sendToCustomer(null, dial, body, {
        failIfUndelivered: true,
      });
    } else {
      this.log.warn(
        "PILOT_OTP_FIXED_ENABLED — SMS chaqirilmaydi; kirish OTP har doim 4444 (pilot)",
      );
    }
    const isDev = this.config.get("NODE_ENV") !== "production";
    const showOtpHint =
      this.pilotFixedOtp() ||
      (isDev && this.devAuthBypass() && !this.realSmsMode());
    return {
      requestId: row.id,
      expiresInSec: Math.max(
        30,
        Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      ),
      ...(showOtpHint ? { devOtp: code } : {}),
    };
  }

  async verifyDriverOtp(
    requestId: string,
    code: string,
  ): Promise<ExchangeAndRefreshResponse> {
    if (!this.isEnabled()) {
      throw new ForbiddenException("OTP login o‘chirilgan");
    }
    const row = await this.prisma.otpLoginChallenge.findFirst({
      where: { id: requestId, consumedAt: null },
    });
    if (!row) {
      throw new UnauthorizedException("Noto‘g‘ri yoki eskirgan so‘rov");
    }
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException("Kod muddati tugagan");
    }
    const h = this.hashCode(row.driverId, code.trim());
    const placeholderOk =
      code.trim() === DEV_SMS_OTP_PLACEHOLDER &&
      (this.devAuthBypass() || this.pilotFixedOtp());
    if (h !== row.codeHash && !placeholderOk) {
      throw new UnauthorizedException("Noto‘g‘ri kod");
    }
    await this.prisma.otpLoginChallenge.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return this.auth.issueDriverTokensById(row.driverId);
  }

  private registrationOtpEnabled(): boolean {
    return (
      this.config.get<string>("DRIVER_REGISTRATION_OTP", "true") === "true"
    );
  }

  /**
   * Phase 19 — telefon allaqachon baza bo‘lgan, lekin hali ariza jarayonida; kirish KODI (alohida `OTP_LOGIN` dan).
   */
  async requestRegistrationOtp(phone: string) {
    if (!this.registrationOtpEnabled()) {
      throw new ForbiddenException(
        "Ro‘yxatdan kirish SMS o‘chirilgan (DRIVER_REGISTRATION_OTP=false)",
      );
    }
    const driverId = await this.findDriverIdByPhone(phone);
    if (!driverId) {
      throw new NotFoundException(
        'Avval "Ro‘yxatdan o‘tish" bosqichida telefoningizni qo‘shing',
      );
    }
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: { select: { status: true } } },
    });
    if (!d) {
      throw new NotFoundException("Haydovchi topilmadi");
    }
    if (d.user.status === UserAccountStatus.SUSPENDED) {
      throw new ForbiddenException("Hisob to‘xtatilgan");
    }
    const okOnboarding: DriverOnboardingStatus[] = [
      DriverOnboardingStatus.DRAFT,
      DriverOnboardingStatus.SUBMITTED,
      DriverOnboardingStatus.UNDER_REVIEW,
      DriverOnboardingStatus.REJECTED,
    ];
    if (!okOnboarding.includes(d.onboardingStatus)) {
      throw new ForbiddenException(
        "Ariza allaqachon yopilgan — oddiy kirish (OTP) ishlating",
      );
    }
    const code = this.usePlaceholderOtpCode()
      ? DEV_SMS_OTP_PLACEHOLDER
      : String(100_000 + randomInt(0, 900_000));
    const codeHash = this.hashCode(driverId, code);
    const expiresAt = new Date(Date.now() + this.ttlMs());
    const row = await this.prisma.otpLoginChallenge.create({
      data: {
        phoneNorm: phone.replace(/\D/g, "") || phone,
        codeHash,
        driverId,
        expiresAt,
      },
    });
    if (!this.pilotFixedOtp()) {
      const body = `Salom Taxi: ariza / kirish kodi — ${code}. Hech kimga bermang.`;
      const p = phone.trim();
      const dial = p.match(/^\+/) ? p : `+${p.replace(/\D/g, "")}`;
      await this.sms.sendToCustomer(null, dial, body, {
        failIfUndelivered: true,
      });
    } else {
      this.log.warn(
        "PILOT_OTP_FIXED_ENABLED — ro‘yxat SMS chaqirilmaydi; kod 4444 (pilot)",
      );
    }
    const tail = phone.replace(/\D/g, "").slice(-4);
    this.log.log(
      `Registration OTP yaratildi requestId=${row.id} phone=…${tail} SMS_MODE=${(this.config.get<string>("SMS_MODE") ?? "log").toLowerCase()} pilot=${this.pilotFixedOtp()}`,
    );
    const isDev = this.config.get("NODE_ENV") !== "production";
    const showOtpHint =
      this.pilotFixedOtp() ||
      (isDev && this.devAuthBypass() && !this.realSmsMode());
    return {
      requestId: row.id,
      registration: true as const,
      expiresInSec: Math.max(
        30,
        Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      ),
      ...(showOtpHint ? { devOtp: code } : {}),
    };
  }

  async verifyRegistrationOtp(
    requestId: string,
    code: string,
  ): Promise<ExchangeAndRefreshResponse> {
    if (!this.registrationOtpEnabled()) {
      throw new ForbiddenException();
    }
    const row = await this.prisma.otpLoginChallenge.findFirst({
      where: { id: requestId, consumedAt: null },
    });
    if (!row) {
      throw new UnauthorizedException("Noto‘g‘ri yoki eskirgan so‘rov");
    }
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException("Kod muddati tugagan");
    }
    const h = this.hashCode(row.driverId, code.trim());
    const placeholderOk =
      code.trim() === DEV_SMS_OTP_PLACEHOLDER &&
      (this.devAuthBypass() || this.pilotFixedOtp());
    if (h !== row.codeHash && !placeholderOk) {
      throw new UnauthorizedException("Noto‘g‘ri kod");
    }
    await this.prisma.otpLoginChallenge.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return this.auth.issueDriverTokensById(row.driverId);
  }
}
