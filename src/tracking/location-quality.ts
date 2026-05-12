const DEFAULT_MAX_AGE_MIN = 2;
/** Shahar / binodagi GPS ko‘pincha 100 m dan yomon; 100 juda qattiq bo‘lib pinglar rad etilardi. */
const DEFAULT_MAX_ACCURACY_M = 350;
const MAX_SPEED_KMH = 220;

export type QualityReject = { code: "stale" | "accuracy" | "speed" | "coords" };

/**
 * Sifat filtrlari: eskirgan, noto'g'ri aniq, noyob tezlik, koordinata chegarasi.
 */
export function isPingQualityOk(
  input: {
    lat: number;
    lng: number;
    accuracyM?: number;
    speedKmh?: number;
    recordedAt?: string;
  },
  options?: { maxAgeMinutes?: number; now?: Date; maxAccuracyM?: number },
): { ok: true } | { ok: false; reason: QualityReject } {
  const { lat, lng, accuracyM, speedKmh, recordedAt } = input;
  const maxAcc = options?.maxAccuracyM ?? DEFAULT_MAX_ACCURACY_M;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, reason: { code: "coords" } };
  }
  if (accuracyM != null && accuracyM > maxAcc) {
    return { ok: false, reason: { code: "accuracy" } };
  }
  if (speedKmh != null && (speedKmh < 0 || speedKmh > MAX_SPEED_KMH)) {
    return { ok: false, reason: { code: "speed" } };
  }
  if (recordedAt) {
    const t = new Date(recordedAt).getTime();
    if (Number.isNaN(t)) {
      return { ok: false, reason: { code: "stale" } };
    }
    const now = options?.now ?? new Date();
    const maxMs = (options?.maxAgeMinutes ?? DEFAULT_MAX_AGE_MIN) * 60_000;
    if (now.getTime() - t > maxMs) {
      return { ok: false, reason: { code: "stale" } };
    }
  }
  return { ok: true };
}

/**
 * 1s ichida anomal «teleport» (pilot: juda soddalashgan chek). Keyingi relizda
 * oldingi ping bilan nisbat.
 */
const MAX_METERS_IN_ONE_SECOND = 80;

export function isPlausibleStep(
  prev: { lat: number; lng: number; t: number } | null,
  next: { lat: number; lng: number; t: number },
): boolean {
  if (!prev) return true;
  const dt = Math.max(0.1, (next.t - prev.t) / 1000);
  const d = distanceMetersHaversine(prev.lat, prev.lng, next.lat, next.lng);
  return d / dt < MAX_METERS_IN_ONE_SECOND * 5;
}

function distanceMetersHaversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
