import { BadRequestException } from "@nestjs/common";

/** Oddiy E.164-ga yaqin: `+998901234567` */
export function normalizePhoneUz(raw: string): string {
  const t = raw.trim();
  if (!t) {
    throw new BadRequestException("Telefon kiritilishi shart");
  }
  const digits = t.replace(/\D/g, "");
  if (digits.length === 9) {
    return `+998${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("998")) {
    return `+${digits}`;
  }
  if (t.startsWith("+") && digits.length >= 9) {
    return `+${digits}`;
  }
  if (digits.length >= 9) {
    return `+${digits}`;
  }
  throw new BadRequestException("Telefon formati noto‘g‘ri");
}
