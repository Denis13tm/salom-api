import * as path from 'node:path';

/**
 * Haydovchi hujjatlari (prava rasmlari va h.k.) — lokal disk.
 * Render: `SALOM_UPLOAD_ROOT` ni persistent disk mount ga qo‘ying (masalan `/var/salom-data`),
 * yoki to‘g‘ridan-to‘g‘ri `DRIVER_DOC_UPLOAD_DIR`.
 */
export function driverDocumentsUploadRoot(): string {
  const explicit = process.env.DRIVER_DOC_UPLOAD_DIR?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const shared = process.env.SALOM_UPLOAD_ROOT?.trim();
  if (shared) {
    return path.resolve(path.join(shared, 'driver-uploads'));
  }
  return path.resolve(path.join(process.cwd(), 'var', 'driver-uploads'));
}

/**
 * Chempionlar admin bannerlari — xuddi shu mount ostida bo‘lsa, deployda yo‘qolmaydi.
 */
export function championsBannersUploadRoot(): string {
  const explicit = process.env.CHAMPIONS_BANNER_UPLOAD_DIR?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const shared = process.env.SALOM_UPLOAD_ROOT?.trim();
  if (shared) {
    return path.resolve(path.join(shared, 'champions-banners'));
  }
  return path.resolve(path.join(process.cwd(), 'var', 'champions-banners'));
}

/** Ephemeral default: faqat env berilmagan (Render disk yo‘q) holat. */
export function uploadsUseDefaultEphemeralPaths(): boolean {
  return (
    !process.env.DRIVER_DOC_UPLOAD_DIR?.trim() &&
    !process.env.SALOM_UPLOAD_ROOT?.trim() &&
    !process.env.CHAMPIONS_BANNER_UPLOAD_DIR?.trim()
  );
}
