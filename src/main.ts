import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import {
  championsBannersUploadRoot,
  driverDocumentsUploadRoot,
  uploadsUseDefaultEphemeralPaths,
} from './config/local-upload-paths';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));
  const config = app.get(ConfigService);

  // localhost va 127.0.0.1 — turli xil "origin" (CORS) hisoblanadi; ikkalasi ham lokal veb uchun
  const defaultCors =
    'http://localhost:3001,http://127.0.0.1:3001,http://localhost:3000,http://127.0.0.1:3000';
  const corsOrigins = config.get<string>('CORS_ORIGIN', defaultCors);
  const origins = corsOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Salom-Driver-Id',
      'X-Salom-Operator-Id',
      'X-Salom-Admin-Id',
      'X-Salom-Exchange-Secret',
      'X-Snapshot-Key',
      'Idempotency-Key',
    ],
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  const driverRoot = driverDocumentsUploadRoot();
  const bannerRoot = championsBannersUploadRoot();
  logger.log(`Local uploads: driverDocs=${driverRoot}, championsBanners=${bannerRoot}`);
  const onRender = Boolean(process.env.RENDER?.trim()) || Boolean(process.env.RENDER_SERVICE_ID?.trim());
  if (onRender && uploadsUseDefaultEphemeralPaths()) {
    logger.warn(
      'SALOM_UPLOAD_ROOT yoki DRIVER_DOC_UPLOAD_DIR o‘rnatilmagan — har deployda konteyner ichidagi var/ tozalanadi. Render’da Web Service → Disks → persistent disk qo‘shing va SALOM_UPLOAD_ROOT ni mount yo‘liga qo‘ying (render.yaml).',
    );
  }

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
}
void bootstrap();
