import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SmsDeliveryStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_SMS_TEMPLATES: Record<string, string> = {
  order_broadcast:
    "Salom Taxi: buyurtmangiz qabul qilindi, haydovchi qidiryapmiz. Mo‘ljal: {{pickupLandmark}}.",
  order_accepted:
    "Salom Taxi: haydovchi buyurtmangizni oldi. Mo‘ljal: {{pickupLandmark}}. Tez orada aloqaga chiqadi.",
  order_cancelled: "Salom Taxi: buyurtma bekor qilindi.",
  passenger_no_show:
    "Salom Taxi: uchrashuv nuqtasida siz kelmadingiz, buyurtma yopildi.",
  trip_completed:
    "Salom Taxi: safar yakunlandi. To‘lov (taxmin): {{grossUzs}} so‘m. Rahmat!",
};

export type SendCustomerSmsOptions = {
  /** OTP / kritik SMS: provayder yubormasa HTTP xato (yashirin muvaffaqiyat emas). */
  failIfUndelivered?: boolean;
};

/** SMS: DB log + ixtiyoriy HTTP provayder (Phase 8) yoki Eskiz.uz. */
@Injectable()
export class SmsService {
  private readonly log = new Logger(SmsService.name);
  /** Eskiz Bearer (JWT) va muddati — xotirada. */
  private eskizBearer: string | null = null;
  private eskizBearerExpiresAtMs = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private fallbackText(code: string): string {
    return DEFAULT_SMS_TEMPLATES[code] ?? `Salom Taxi: ${code}`;
  }

  private applyVarsSync(text: string, vars: Record<string, string>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
      const v = Object.prototype.hasOwnProperty.call(vars, k)
        ? vars[k]
        : undefined;
      return typeof v === "string" ? v : "";
    });
  }

  /** +998… yoki 998… → Eskiz `mobile_phone` (faqat raqam, 998 bilan). */
  private toEskizMobile(toPhone: string): string {
    const d = toPhone.replace(/\D/g, "");
    if (d.startsWith("998") && d.length >= 12) return d;
    if (d.length === 9) return `998${d}`;
    throw new Error(`Eskiz: telefon formati noto‘g‘ri (${toPhone})`);
  }

  private decodeJwtExpMs(token: string): number | null {
    try {
      const p = token.split(".")[1];
      if (!p) return null;
      const b64 = p.replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
      const json = JSON.parse(
        Buffer.from(b64 + pad, "base64").toString("utf8"),
      ) as { exp?: number };
      return typeof json.exp === "number" && Number.isFinite(json.exp)
        ? json.exp * 1000
        : null;
    } catch {
      return null;
    }
  }

  private extractEskizToken(body: unknown): string | null {
    if (typeof body !== "object" || body === null) return null;
    const o = body as Record<string, unknown>;
    if (typeof o.token === "string" && o.token.length > 10) return o.token;
    const msg = o.message;
    if (typeof msg === "string" && msg.length > 40 && !/\s/.test(msg))
      return msg;
    const data = o.data;
    if (typeof data === "object" && data !== null) {
      const d = data as Record<string, unknown>;
      if (typeof d.token === "string") return d.token;
    }
    return null;
  }

  private async ensureEskizBearer(): Promise<string> {
    const skew = 120_000;
    if (this.eskizBearer && this.eskizBearerExpiresAtMs > Date.now() + skew) {
      return this.eskizBearer;
    }
    const base = this.config
      .get<string>("ESKIZ_API_BASE", "https://notify.eskiz.uz")
      .replace(/\/+$/, "");
    const email = this.config.get<string>("ESKIZ_EMAIL")?.trim();
    const password = this.config.get<string>("ESKIZ_PASSWORD")?.trim();
    if (!email || !password) {
      throw new Error(
        "ESKIZ_EMAIL va ESKIZ_PASSWORD majburiy (SMS_MODE=eskiz)",
      );
    }
    const form = new FormData();
    form.set("email", email);
    form.set("password", password);
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      body: form,
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Eskiz auth: JSON emas (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`Eskiz auth HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const token = this.extractEskizToken(json);
    if (!token) {
      throw new Error(
        "Eskiz auth: token topilmadi (javob formati o‘zgargan bo‘lishi mumkin)",
      );
    }
    this.eskizBearer = token;
    const expMs = this.decodeJwtExpMs(token);
    this.eskizBearerExpiresAtMs = expMs ?? Date.now() + 20 * 3600 * 1000;
    return token;
  }

  private async sendViaEskiz(
    toPhone: string,
    body: string,
  ): Promise<string | undefined> {
    const base = this.config
      .get<string>("ESKIZ_API_BASE", "https://notify.eskiz.uz")
      .replace(/\/+$/, "");
    const from = this.config.get<string>("ESKIZ_FROM")?.trim();
    if (!from) {
      throw new Error(
        "ESKIZ_FROM majburiy (Eskiz kabinetidagi yuboruvchi nomi / raqam)",
      );
    }
    const mobile_phone = this.toEskizMobile(toPhone);
    const bearer = await this.ensureEskizBearer();
    const form = new FormData();
    form.set("mobile_phone", mobile_phone);
    form.set("message", body);
    form.set("from", from);
    form.set("callback_url", "");
    const res = await fetch(`${base}/api/message/sms/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
      },
      body: form,
    });
    const t = await res.text();
    if (!res.ok) {
      this.eskizBearer = null;
      this.eskizBearerExpiresAtMs = 0;
      throw new Error(`Eskiz send HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    try {
      const json = JSON.parse(t) as Record<string, unknown>;
      const id =
        json.id ??
        json.request_id ??
        (json.data as Record<string, unknown> | undefined)?.id;
      if (id == null) return undefined;
      if (
        typeof id === "string" ||
        typeof id === "number" ||
        typeof id === "bigint"
      )
        return String(id);
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** Admin `SmsTemplate` yoki `DEFAULT_SMS_TEMPLATES` (`{{token}}` almashtirish). */
  async buildCustomerMessage(
    code: string,
    vars: Record<string, string>,
  ): Promise<string> {
    const row = await this.prisma.smsTemplate.findFirst({
      where: { code, isActive: true },
    });
    const raw = row?.bodyUz ?? this.fallbackText(code);
    return this.applyVarsSync(raw, vars);
  }

  /**
   * Mijoz raqamiga SMS; avvalo `SMSLog`, keyin `SMS_MODE` bo‘yicha yuborish yoki faqat log.
   */
  async sendToCustomer(
    orderId: string | null,
    toPhone: string,
    body: string,
    opts?: SendCustomerSmsOptions,
  ): Promise<{ logId: string }> {
    const row = await this.prisma.sMSLog.create({
      data: {
        orderId,
        toPhone,
        body,
        status: SmsDeliveryStatus.QUEUED,
      },
    });
    const mode = (this.config.get<string>("SMS_MODE") ?? "log").toLowerCase();
    if (mode === "log" || mode === "stub" || mode === "") {
      await this.prisma.sMSLog.update({
        where: { id: row.id },
        data: { status: SmsDeliveryStatus.SENT, sentAt: new Date() },
      });
      const tail = toPhone.replace(/\D/g, "").slice(-4);
      this.log.warn(
        `SMS_MODE=${mode || "log"} — haqiqiy SMS yuborilmadi (faqat jurnal). Tel …${tail}. Render: SMS_MODE=eskiz, ESKIZ_EMAIL, ESKIZ_PASSWORD, ESKIZ_FROM`,
      );
      this.log.debug(`SMS(log) -> ${toPhone}: ${body.slice(0, 80)}…`);
      if (opts?.failIfUndelivered) {
        throw new ServiceUnavailableException(
          "SMS_MODE=log/stub — operator tarmog‘iga SMS yuborilmaydi. Production’da SMS_MODE=eskiz va Eskiz kalitlari kerak.",
        );
      }
      return { logId: row.id };
    }
    if (mode === "eskiz") {
      const maxRetries = Math.max(
        0,
        Number(this.config.get("SMS_HTTP_MAX_RETRIES") ?? 3),
      );
      let lastErr = "";
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const providerId = await this.sendViaEskiz(toPhone, body);
          await this.prisma.sMSLog.update({
            where: { id: row.id },
            data: {
              status: SmsDeliveryStatus.SENT,
              sentAt: new Date(),
              providerId,
            },
          });
          return { logId: row.id };
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          this.log.warn(
            `SMS eskiz urinish ${attempt + 1}/${maxRetries + 1}: ${lastErr}`,
          );
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }
      await this.prisma.sMSLog.update({
        where: { id: row.id },
        data: {
          status: SmsDeliveryStatus.FAILED,
          error: lastErr || "eskiz_failed",
        },
      });
      this.log.warn(`SMS eskiz yakuniy xato: ${lastErr}`);
      if (opts?.failIfUndelivered) {
        throw new ServiceUnavailableException(
          `SMS yuborilmadi (Eskiz). Test rejimida faqat ruxsat etilgan matnlar; ishlab chiqarishda shartnoma/shablon kerak. Xato: ${lastErr}`,
        );
      }
      return { logId: row.id };
    }
    if (mode === "http") {
      const url = this.config.get<string>("SMS_HTTP_URL");
      if (!url) {
        this.log.warn(
          "SMS_MODE=http lekin SMS_HTTP_URL yo‘q; SENT deb belgilandi",
        );
        await this.prisma.sMSLog.update({
          where: { id: row.id },
          data: { status: SmsDeliveryStatus.SENT, sentAt: new Date() },
        });
        return { logId: row.id };
      }
      const maxRetries = Math.max(
        0,
        Number(this.config.get("SMS_HTTP_MAX_RETRIES") ?? 3),
      );
      const timeoutMs = Math.max(
        1000,
        Number(this.config.get("SMS_HTTP_TIMEOUT_MS") ?? 15_000),
      );
      let lastErr = "";
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), timeoutMs);
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          const extra = this.config
            .get<string>("SMS_HTTP_HEADERS_JSON")
            ?.trim();
          if (extra) {
            try {
              const parsed = JSON.parse(extra) as Record<string, string>;
              for (const [k, v] of Object.entries(parsed)) {
                if (k && v != null) headers[k] = String(v);
              }
            } catch {
              this.log.warn("SMS_HTTP_HEADERS_JSON JSON emas, e’tiborsiz");
            }
          }
          const bodyPayload = {
            to: toPhone,
            body,
            orderId,
            logId: String(row.id),
          };
          const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(bodyPayload),
            signal: ac.signal,
          });
          clearTimeout(t);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const providerId = res.headers.get("x-provider-id") ?? undefined;
          await this.prisma.sMSLog.update({
            where: { id: row.id },
            data: {
              status: SmsDeliveryStatus.SENT,
              sentAt: new Date(),
              providerId,
            },
          });
          return { logId: row.id };
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          this.log.warn(
            `SMS http urinish ${attempt + 1}/${maxRetries + 1}: ${lastErr}`,
          );
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
      }
      await this.prisma.sMSLog.update({
        where: { id: row.id },
        data: {
          status: SmsDeliveryStatus.FAILED,
          error: lastErr || "http_failed",
        },
      });
      this.log.warn(`SMS http yakuniy xato: ${lastErr}`);
      if (opts?.failIfUndelivered) {
        throw new ServiceUnavailableException(
          `SMS yuborilmadi (HTTP): ${lastErr}`,
        );
      }
      return { logId: row.id };
    }
    await this.prisma.sMSLog.update({
      where: { id: row.id },
      data: { status: SmsDeliveryStatus.SENT, sentAt: new Date() },
    });
    return { logId: row.id };
  }
}
