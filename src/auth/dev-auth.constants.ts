/** Tashqi SMS yo‘q paytda dev/staging’da test uchun (production’da ishlatilmaydi). */
export const DEV_SMS_OTP_PLACEHOLDER = "4444";

/** 12 xonali faollashtirish uchun dev placeholder (production’da ishlatilmaydi). */
export const DEV_ACTIVATION_12_PLACEHOLDER = "111111111111";

/**
 * Eskiz shartnomasiz pilot (production’da ham): OTP har doim `DEV_SMS_OTP_PLACEHOLDER`, SMS yuborilmaydi.
 * Haqiqiy ishga tushganda Render’da `PILOT_OTP_FIXED_ENABLED=false` qiling.
 */
export function isPilotFixedOtpEnabled(raw: string | undefined): boolean {
  return raw === "true";
}

/**
 * `DEV_AUTH_BYPASS=false` bo‘lsa dev placeholder’lar o‘chadi.
 * `NODE_ENV=production` bo‘lsa har doim false.
 */
export function isDevAuthBypassEnabled(
  nodeEnv: string | undefined,
  devAuthBypass: string | undefined,
): boolean {
  if (nodeEnv === "production") return false;
  return devAuthBypass !== "false";
}
