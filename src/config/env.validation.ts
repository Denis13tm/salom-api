import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),
  DATABASE_URL: Joi.string().optional(),
  REDIS_URL: Joi.string().optional(),
  TRACKING_SNAPSHOT_KEY: Joi.string().optional().allow(''),
  TRACKING_MAX_PING_AGE_MINUTES: Joi.number().min(1).max(60).default(2),
  DISPATCH_MAX_DRIVERS_PER_ROUND: Joi.number().min(1).max(20).default(5),
  DISPATCH_OFFER_TTL_SEC: Joi.number().min(10).max(300).default(45),
  /** METERED taxometr: boshlang‘ich (so‘m), keyin 1 km uchun. */
  METER_BASE_FARE_UZS: Joi.number().min(0).default(5000),
  METER_PER_KM_UZS: Joi.number().min(0).default(5000),
  /** GPS shovqin; undan kichik segment yig‘ilmaydi. */
  METER_MIN_SEGMENT_M: Joi.number().min(1).max(200).default(12),
  /** Segment bo‘yicha taxminiy tezlik shundan past bo‘lsa, masofa qo‘shilmaydi (to‘xtash). */
  METER_IDLE_MAX_IMPLIED_KMH: Joi.number().min(0).max(30).default(4),
  /** «Mo‘ljalga kelish»: pickup koordinata berilganda haydovchi shu nuqtagacha masofa */
  PICKUP_NEARBY_RADIUS_M: Joi.number().min(30).max(500).default(180),
  /** Platforma komissiyasi, bps (1000 = 10%). */
  PLATFORM_COMMISSION_BPS: Joi.number().min(0).max(10_000).default(1000),
  /** Prepaid commission wallet: past bo‘lsa haydovchiga yangi order berilmaydi. */
  COMMISSION_WALLET_MIN_BROADCAST_BALANCE_UZS: Joi.number().min(-1_000_000).default(10_000),
  /** Driver app ogohlantirish threshold. */
  COMMISSION_WALLET_LOW_BALANCE_UZS: Joi.number().min(0).default(30_000),
  /** Bir martalik haydovchi yangilik broadcastidagi maksimal qabul qiluvchilar. */
  ADMIN_DRIVER_BROADCAST_MAX_TARGETS: Joi.number().min(1).max(100_000).default(15_000),
  /** SMS: `log` | `http` (o‘z gateway) | `eskiz` (notify.eskiz.uz). */
  SMS_MODE: Joi.string().valid('log', 'stub', 'http', 'eskiz').default('log'),
  SMS_HTTP_URL: Joi.string().uri().optional().allow(''),
  /** Eskiz: my.eskiz.uz — API email/parol, «Yuboruvchi» (masalan 4546 yoki sizning nom). */
  ESKIZ_EMAIL: Joi.string().min(3).max(128).optional().allow(''),
  ESKIZ_PASSWORD: Joi.string().optional().allow(''),
  ESKIZ_FROM: Joi.string().max(32).optional().allow(''),
  ESKIZ_API_BASE: Joi.string().uri().optional().default('https://notify.eskiz.uz'),
  /** HTTP provayder uchun qayta urinish (0 = bitta urinish). */
  SMS_HTTP_MAX_RETRIES: Joi.number().min(0).max(8).default(3),
  SMS_HTTP_TIMEOUT_MS: Joi.number().min(1000).max(120_000).default(15_000),
  /** ixtiyoriy JSON: `{"Authorization":"Bearer …"}` — HTTP provayder sarlavhalari. */
  SMS_HTTP_HEADERS_JSON: Joi.string().optional().allow(''),
  /** Provayder `POST /api/v1/webhooks/sms/delivery` chaqirishi uchun (bo‘sh = webhook o‘chiq). */
  SMS_DELIVERY_WEBHOOK_SECRET: Joi.string().optional().allow(''),
  /** Phase 18: hozir `false` — to‘liq OTP keyin. */
  OTP_LOGIN_ENABLED: Joi.string().valid('true', 'false').default('false'),
  /** Phase 19: ariza jarayonida `registration/otp` SMS. */
  DRIVER_REGISTRATION_OTP: Joi.string().valid('true', 'false').default('true'),
  /**
   * `false` — dev placeholder SMS/OTP (`4444`) va 12 raqam (`111…`) o‘chiriladi.
   * Production’da yondashuv har doim o‘chiq; faqat not-production muhitda ta’sir qiladi.
   */
  DEV_AUTH_BYPASS: Joi.string().valid('true', 'false').default('true'),
  /**
   * Pilot (shu jumladan production): OTP doim `4444`, SMS chaqirilmaydi — Eskiz shartnomasiz test.
   * Tijoriy ishga o‘tganda majburiy `false`.
   */
  PILOT_OTP_FIXED_ENABLED: Joi.string().valid('true', 'false').default('false'),
  OTP_TTL_MINUTES: Joi.number().min(1).max(60).default(10),
  OTP_PEPPER: Joi.string().optional().allow(''),
  /** Push: `log` = faqat jurnal; `fcm` = FCM HTTP v1 (`FCM_SERVICE_ACCOUNT_*`). */
  PUSH_MODE: Joi.string().valid('log', 'stub', 'fcm').default('log'),
  /** Google service account JSON (bitta qator, production’da secret). */
  FCM_SERVICE_ACCOUNT_JSON: Joi.string().optional().allow(''),
  /** Yoki fayl yo‘li (lokal/VM). */
  FCM_SERVICE_ACCOUNT_PATH: Joi.string().optional().allow(''),
  /** Access JWT (Phase 9). Production’da kuchli qiymat. */
  JWT_SECRET: Joi.string().min(16).default('salom-dev-jwt-secret-change-me'),
  /** Access TTL (ustun: `JWT_ACCESS_EXPIRES`; bo‘lmasa `JWT_EXPIRES`). */
  JWT_ACCESS_EXPIRES: Joi.string().optional().allow(''),
  JWT_EXPIRES: Joi.string().default('7d'),
  /** Phase 12: refresh session muddat. */
  JWT_REFRESH_EXPIRES: Joi.string().default('30d'),
  /**
   * `POST /auth/exchange/*` — pilot: bir xil server va mobil build’da bo‘lishi kerak.
   * Production’da majburiy (bo‘sh bo‘lsa exchange taqiqlanadi).
   */
  SALOM_EXCHANGE_SECRET: Joi.string().optional().allow(''),
  /** Brauzer admin panel: `POST /auth/admin/web-login` — production’da tavsiya. */
  ADMIN_WEB_PASSWORD: Joi.string().optional().allow(''),
  /** `false` bo‘lsa faqat `Authorization: Bearer` (haydovchi/operator/admin legacy header yo‘q). */
  ALLOW_LEGACY_AUTH_HEADERS: Joi.string()
    .valid('true', 'false')
    // Lokal dev: UUID header bilan Admin panel ishlayveradi; production’da odatda Bearer only.
    .default(process.env.NODE_ENV === 'development' ? 'true' : 'false'),
});
