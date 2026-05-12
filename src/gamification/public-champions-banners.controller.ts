import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  CHAMPIONS_BANNER_FILE_RE,
  championsBannerUploadDir,
  contentTypeForBannerExt,
} from './champions-banners.util';

@Controller({ path: 'public/champions-banners', version: '1' })
export class PublicChampionsBannersController {
  @Get(':file')
  serve(@Param('file') fileRaw: string, @Res({ passthrough: false }) res: Response): void {
    const file = path.basename(fileRaw || '');
    if (!CHAMPIONS_BANNER_FILE_RE.test(file)) {
      throw new NotFoundException();
    }
    const full = path.join(championsBannerUploadDir(), file);
    if (!existsSync(full)) {
      throw new NotFoundException();
    }
    const ext = path.extname(file);
    res.setHeader('Content-Type', contentTypeForBannerExt(ext));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    createReadStream(full).pipe(res);
  }
}
