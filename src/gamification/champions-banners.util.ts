import { championsBannersUploadRoot } from '../config/local-upload-paths';

/** UUID v4 + ruxsat etilgan kengaytmalar (admin yuklash / public serve). */
export const CHAMPIONS_BANNER_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$/i;

export function championsBannerUploadDir(): string {
  return championsBannersUploadRoot();
}

export function contentTypeForBannerExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

export function parseBannerPathsJson(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  const out: string[] = [];
  for (const x of json) {
    if (typeof x !== 'string') continue;
    const t = x.trim();
    if (!CHAMPIONS_BANNER_FILE_RE.test(t)) continue;
    out.push(t);
  }
  return out;
}

export function bannerPathsToPublicUrls(paths: string[]): string[] {
  return paths.map((p) => `/api/v1/public/champions-banners/${p}`);
}
