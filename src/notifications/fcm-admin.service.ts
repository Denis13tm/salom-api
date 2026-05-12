import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';

/**
 * `PUSH_MODE=fcm` — Firebase Admin (HTTP v1) sozlash.
 * `FCM_SERVICE_ACCOUNT_JSON` yoki `FCM_SERVICE_ACCOUNT_PATH` (service account .json fayl).
 */
@Injectable()
export class FcmAdminService implements OnModuleInit {
  private readonly log = new Logger(FcmAdminService.name);
  private ready = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const mode = (this.config.get<string>('PUSH_MODE') ?? 'log').toLowerCase();
    if (mode !== 'fcm') {
      return;
    }
    if (admin.apps.length > 0) {
      this.ready = true;
      return;
    }
    const json = this.config.get<string>('FCM_SERVICE_ACCOUNT_JSON')?.trim();
    const path = this.config.get<string>('FCM_SERVICE_ACCOUNT_PATH')?.trim();
    try {
      if (json) {
        const cred = JSON.parse(json) as admin.ServiceAccount;
        admin.initializeApp({ credential: admin.credential.cert(cred) });
        this.log.log('FCM: service account (FCM_SERVICE_ACCOUNT_JSON)');
        this.ready = true;
        return;
      }
      if (path) {
        const raw = readFileSync(path, 'utf-8');
        const cred = JSON.parse(raw) as admin.ServiceAccount;
        admin.initializeApp({ credential: admin.credential.cert(cred) });
        this.log.log('FCM: service account (FCM_SERVICE_ACCOUNT_PATH)');
        this.ready = true;
        return;
      }
      this.log.warn('PUSH_MODE=fcm, lekin FCM service account kiritilmagan; push muvaffaqiyatsiz bo‘ladi');
    } catch (e) {
      this.log.error(
        `FCM init: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  isReady(): boolean {
    if (this.ready) return true;
    if (admin.apps.length > 0) {
      this.ready = true;
    }
    return this.ready;
  }

  getMessaging(): admin.messaging.Messaging {
    return admin.messaging();
  }
}
