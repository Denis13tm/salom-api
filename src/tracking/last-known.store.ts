import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import type IORedis from 'ioredis';
import { REDIS_CLIENT } from './redis-tokens';

export type LastDriverLocation = {
  driverId: string;
  serviceZoneId: string | null;
  lat: number;
  lng: number;
  recordedAt: string;
  accuracyM?: number;
  speedKmh?: number;
};

/**
 * In-process last-known index for operator snapshot + WebSocket.
 * (Redis is optional best-effort mirror; multi-node reads would need Redis as source of truth.)
 */
@Injectable()
export class LastKnownStore implements OnModuleDestroy {
  private readonly byDriver = new Map<string, LastDriverLocation>();
  private readonly byZone = new Map<string, Map<string, LastDriverLocation>>();
  private lastZoneByDriver = new Map<string, string | null>();

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: IORedis | null) {}

  onModuleDestroy() {
    if (this.redis) this.redis.disconnect();
  }

  set(snap: LastDriverLocation) {
    const prevZone = this.lastZoneByDriver.get(snap.driverId);
    if (prevZone && prevZone !== snap.serviceZoneId) {
      this.byZone.get(prevZone)?.delete(snap.driverId);
    }
    this.lastZoneByDriver.set(snap.driverId, snap.serviceZoneId);
    this.byDriver.set(snap.driverId, snap);
    if (snap.serviceZoneId) {
      if (!this.byZone.has(snap.serviceZoneId)) {
        this.byZone.set(snap.serviceZoneId, new Map());
      }
      this.byZone.get(snap.serviceZoneId)!.set(snap.driverId, snap);
    }
    if (this.redis) {
      const key = `salom:lk:${snap.driverId}`;
      void this.redis.set(key, JSON.stringify(snap), 'EX', 3600);
    }
  }

  getZoneSnapshot(serviceZoneId: string): LastDriverLocation[] {
    return [...(this.byZone.get(serviceZoneId)?.values() ?? [])];
  }

  getOne(driverId: string): LastDriverLocation | undefined {
    return this.byDriver.get(driverId);
  }
}
