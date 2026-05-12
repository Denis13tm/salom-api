import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DriverOperationalStatus,
  OrderAssignmentStatus,
  OrderStatus,
  Prisma,
  TripEventType,
  TripStatus,
  UserAccountStatus,
} from '@prisma/client';
import { distanceMetersHaversine } from '../common/haversine';
import { PrismaService } from '../prisma/prisma.service';
import { OperationalNotificationsService } from '../notifications/operational-notifications.service';
import { LastKnownStore } from '../tracking/last-known.store';
import { DriverGateway } from '../driver-ws/driver.gateway';
import { OperatorGateway } from '../tracking/operator.gateway';
import { LedgerService } from '../ledger/ledger.service';
import { BroadcastOrderDto } from './dto/broadcast-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { PricingEngineService } from './pricing-engine.service';

@Injectable()
export class DispatchService {
  private readonly log = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly lastKnown: LastKnownStore,
    private readonly driverGateway: DriverGateway,
    private readonly operatorGateway: OperatorGateway,
    private readonly notify: OperationalNotificationsService,
    private readonly pricing: PricingEngineService,
    private readonly ledger: LedgerService,
  ) {}

  private defaultMaxDrivers() {
    return this.config.get<number>('DISPATCH_MAX_DRIVERS_PER_ROUND', 5);
  }

  private defaultOfferTtlSec() {
    return this.config.get<number>('DISPATCH_OFFER_TTL_SEC', 45);
  }

  private async walletThresholds() {
    const t = await this.ledger.resolveCommissionWalletThresholds();
    return {
      minDispatchBalanceUzs: t.minBroadcastBalanceUzs,
      lowBalanceThresholdUzs: t.lowBalanceUzs,
    };
  }

  /**
   * Eskirgan PENDING — EXPIRED; haydovchini ONLINE_IDLE qaytarish (bitta offer taxmini).
   */
  async expireStaleAssignments() {
    const now = new Date();
    const stale = await this.prisma.orderAssignment.findMany({
      where: { status: OrderAssignmentStatus.PENDING, expiresAt: { lt: now } },
      select: { id: true, driverId: true, orderId: true },
    });
    for (const a of stale) {
      await this.prisma.orderAssignment.update({
        where: { id: a.id },
        data: { status: OrderAssignmentStatus.EXPIRED, decidedAt: now },
      });
      await this.prisma.driver.updateMany({
        where: { id: a.driverId, operationalStatus: DriverOperationalStatus.ORDER_OFFERED },
        data: { operationalStatus: DriverOperationalStatus.ONLINE_IDLE },
      });
    }
  }

  async createOrder(dto: CreateOrderDto, createdByOperatorId: string) {
    const pricing = await this.pricing.snapshotForOrder({
      serviceZoneId: dto.serviceZoneId,
      pickupLat: dto.pickupLat,
      pickupLng: dto.pickupLng,
      pricingRingId: dto.pricingRingId,
    });
    const data: Prisma.OrderCreateInput = {
      serviceZone: { connect: { id: dto.serviceZoneId } },
      pricingProfile: { connect: { id: pricing.pricingProfileId } },
      pricingRing: { connect: { id: pricing.pricingRingId } },
      customerPhone: dto.customerPhone,
      pickupLandmark: dto.pickupLandmark,
      dropoffText: dto.dropoffText,
      notes: dto.notes,
      paymentType: dto.paymentType,
      fareMode: dto.fareMode,
      status: OrderStatus.CREATED,
      createdBy: { connect: { id: createdByOperatorId } },
      pickupPricingZoneName: pricing.pickupPricingZoneName,
      pickupDistanceFromCenterKm: pricing.pickupDistanceFromCenterKm,
      starterFeeUzs: pricing.starterFeeUzs,
      distanceRateUzs: pricing.distanceRateUzs,
      freeWaitMinutes: pricing.freeWaitMinutes,
      waitingFeePerMinuteUzs: pricing.waitingFeePerMinuteUzs,
      pricingOverridden: pricing.pricingOverridden,
      pricingOverrideReason: pricing.pricingOverrideReason,
    };
    if (dto.operatorEnteredFareUzs != null) {
      data.operatorEnteredFareUzs = new Prisma.Decimal(dto.operatorEnteredFareUzs);
    }
    if (dto.pickupLat != null && dto.pickupLng != null) {
      data.pickupLat = new Prisma.Decimal(dto.pickupLat);
      data.pickupLng = new Prisma.Decimal(dto.pickupLng);
    }
    return this.prisma.order.create({ data, include: { serviceZone: true } });
  }

  private async selectCandidateDrivers(
    serviceZoneId: string,
    maxDrivers: number,
  ): Promise<string[]> {
    const zone = await this.prisma.serviceZone.findUnique({
      where: { id: serviceZoneId },
      select: { centerLat: true, centerLng: true },
    });
    if (!zone) {
      return [];
    }
    const cLat = Number(zone.centerLat);
    const cLng = Number(zone.centerLng);

    const thresholds = await this.walletThresholds();
    const online = await this.prisma.driver.findMany({
      where: {
        serviceZoneId,
        operationalStatus: DriverOperationalStatus.ONLINE_IDLE,
        balanceUzs: {
          gte: new Prisma.Decimal(thresholds.minDispatchBalanceUzs),
        },
        user: { status: UserAccountStatus.ACTIVE },
      },
      select: { id: true },
    });
    if (online.length === 0) {
      return [];
    }

    const inZone = this.lastKnown.getZoneSnapshot(serviceZoneId);
    const byId = new Map(inZone.map((d) => [d.driverId, d]));

    const scored = online.map((d) => {
      const lk = byId.get(d.id);
      const dist = lk
        ? distanceMetersHaversine(cLat, cLng, lk.lat, lk.lng)
        : Number.POSITIVE_INFINITY;
      return { id: d.id, dist };
    });
    scored.sort((a, b) => a.dist - b.dist);
    return scored.slice(0, maxDrivers).map((s) => s.id);
  }

  /**
   * Birinchi: CREATED → BROADCASTED. Qayta: faqat yangi round (oldingi PENDING superseed).
   */
  async broadcastOrder(orderId: string, body: BroadcastOrderDto) {
    await this.expireStaleAssignments();
    const maxD = body.maxDrivers ?? this.defaultMaxDrivers();
    const ttlSec = body.offerTtlSec ?? this.defaultOfferTtlSec();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSec * 1000);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { serviceZone: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.CREATED && order.status !== OrderStatus.BROADCASTED) {
      throw new ConflictException(`Order not broadcastable: ${order.status}`);
    }
    if (!order.serviceZoneId) {
      throw new BadRequestException('Order has no service zone');
    }

    const agg = await this.prisma.orderAssignment.aggregate({
      where: { orderId },
      _max: { round: true },
    });
    const nextRound = (agg._max.round ?? 0) + 1;

    const pending = await this.prisma.orderAssignment.findMany({
      where: { orderId, status: OrderAssignmentStatus.PENDING },
      select: { id: true, driverId: true },
    });
    for (const p of pending) {
      await this.prisma.orderAssignment.update({
        where: { id: p.id },
        data: { status: OrderAssignmentStatus.SUPERSEDED, decidedAt: now },
      });
      await this.prisma.driver.updateMany({
        where: { id: p.driverId, operationalStatus: DriverOperationalStatus.ORDER_OFFERED },
        data: { operationalStatus: DriverOperationalStatus.ONLINE_IDLE },
      });
    }

    const driverIds = await this.selectCandidateDrivers(order.serviceZoneId, maxD);
    if (driverIds.length === 0) {
      const { minDispatchBalanceUzs } = await this.walletThresholds();
      const [onlineIdle, blockedByBalance] = await Promise.all([
        this.prisma.driver.count({
          where: {
            serviceZoneId: order.serviceZoneId,
            operationalStatus: DriverOperationalStatus.ONLINE_IDLE,
            user: { status: UserAccountStatus.ACTIVE },
          },
        }),
        this.prisma.driver.count({
          where: {
            serviceZoneId: order.serviceZoneId,
            operationalStatus: DriverOperationalStatus.ONLINE_IDLE,
            balanceUzs: { lt: new Prisma.Decimal(minDispatchBalanceUzs) },
            user: { status: UserAccountStatus.ACTIVE },
          },
        }),
      ]);
      throw new BadRequestException({
        code: 'NO_ELIGIBLE_DRIVERS',
        reason:
          onlineIdle > 0 && blockedByBalance === onlineIdle
            ? 'LOW_COMMISSION_WALLET_BALANCE'
            : 'NO_ONLINE_IDLE_DRIVERS',
        message:
          onlineIdle > 0 && blockedByBalance === onlineIdle
            ? `Online haydovchilar bor, lekin balans min dispatch threshold (${minDispatchBalanceUzs} so'm) dan past.`
            : 'No online drivers in zone (ONLINE_IDLE)',
        onlineIdle,
        blockedByBalance,
        minDispatchBalanceUzs,
      });
    }

    const assignments: { id: string; driverId: string }[] = [];
    for (const driverId of driverIds) {
      const a = await this.prisma.orderAssignment.create({
        data: {
          orderId,
          driverId,
          round: nextRound,
          status: OrderAssignmentStatus.PENDING,
          offeredAt: now,
          expiresAt,
        },
      });
      assignments.push({ id: a.id, driverId });
      await this.prisma.driver.update({
        where: { id: driverId },
        data: { operationalStatus: DriverOperationalStatus.ORDER_OFFERED },
      });
    }

    const updateOrder =
      order.status === OrderStatus.CREATED
        ? await this.prisma.order.update({
            where: { id: orderId },
            data: { status: OrderStatus.BROADCASTED, broadcastedAt: now },
            include: { serviceZone: true },
          })
        : order;

    const gate = await this.walletThresholds();
    const payload = {
      type: 'broadcast',
      orderId,
      round: nextRound,
      offerTtlSec: ttlSec,
      driverIds,
      financeGate: gate,
      order: {
        id: order.id,
        status: OrderStatus.BROADCASTED,
        customerPhone: order.customerPhone,
        pickupLandmark: order.pickupLandmark,
        dropoffText: order.dropoffText,
        paymentType: order.paymentType,
        operatorEnteredFareUzs: order.operatorEnteredFareUzs?.toString() ?? null,
        serviceZoneId: order.serviceZoneId,
      },
    };

    for (const d of driverIds) {
      this.driverGateway.emitOrderOffered(d, {
        orderId: order.id,
        assignmentTtlSec: ttlSec,
        order: payload.order,
        financeGate: payload.financeGate,
      });
    }
    this.operatorGateway.emitOrderUpdate(order.serviceZoneId, payload);

    void this.notify
      .onOrderBroadcast({
        id: order.id,
        customerPhone: order.customerPhone,
        pickupLandmark: order.pickupLandmark,
      })
      .catch((e) => this.log.warn(`SMS after broadcast: ${e instanceof Error ? e.message : e}`));

    return {
      order: updateOrder,
      round: nextRound,
      offeredTo: driverIds,
      assignmentIds: assignments,
      expiresAt: expiresAt.toISOString(),
      financeGate: gate,
    };
  }

  async getCurrentOffer(driverId: string) {
    await this.expireStaleAssignments();
    const a = await this.prisma.orderAssignment.findFirst({
      where: {
        driverId,
        status: OrderAssignmentStatus.PENDING,
        expiresAt: { gt: new Date() },
        order: { status: OrderStatus.BROADCASTED },
      },
      orderBy: { offeredAt: 'desc' },
      include: { order: { include: { serviceZone: true } } },
    });
    if (!a) {
      const driver = await this.prisma.driver.findUnique({
        where: { id: driverId },
        select: { balanceUzs: true },
      });
      const thresholds = await this.walletThresholds();
      const balance = Number(driver?.balanceUzs ?? 0);
      return {
        offer: null as null,
        financeGate: {
          ...thresholds,
          balanceUzs: driver?.balanceUzs.toString() ?? '0',
          status:
            balance < thresholds.minDispatchBalanceUzs
              ? 'blocked'
              : balance < thresholds.lowBalanceThresholdUzs
                ? 'low'
                : 'ok',
          reason: balance < thresholds.minDispatchBalanceUzs ? 'LOW_COMMISSION_WALLET_BALANCE' : null,
        },
      };
    }
    const offerGate = await this.walletThresholds();
    return {
      offer: {
        assignmentId: a.id,
        orderId: a.orderId,
        round: a.round,
        expiresAt: a.expiresAt.toISOString(),
        order: {
          id: a.order.id,
          status: a.order.status,
          customerPhone: a.order.customerPhone,
          pickupLandmark: a.order.pickupLandmark,
          dropoffText: a.order.dropoffText,
          paymentType: a.order.paymentType,
          fareMode: a.order.fareMode,
          operatorEnteredFareUzs: a.order.operatorEnteredFareUzs?.toString() ?? null,
          starterFeeUzs:
            a.order.starterFeeUzs?.toString() ??
            a.order.serviceZone?.starterFeeUzs?.toString() ??
            a.order.serviceZone?.meterBaseUzs?.toString() ??
            null,
        },
      },
      financeGate: offerGate,
    };
  }

  async acceptOrder(orderId: string, driverId: string) {
    await this.expireStaleAssignments();
    const { minDispatchBalanceUzs } = await this.walletThresholds();
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status !== OrderStatus.BROADCASTED) {
        throw new ConflictException(`Order not in broadcast state: ${order.status}`);
      }

      const driver = await tx.driver.findUnique({
        where: { id: driverId },
        select: { balanceUzs: true },
      });
      if (!driver || driver.balanceUzs.lt(new Prisma.Decimal(minDispatchBalanceUzs))) {
        throw new ConflictException({
          code: 'LOW_COMMISSION_WALLET_BALANCE',
          message: `Balans min dispatch threshold (${minDispatchBalanceUzs} so'm) dan past.`,
          balanceUzs: driver?.balanceUzs.toString() ?? '0',
          minDispatchBalanceUzs,
        });
      }

      const asg = await tx.orderAssignment.findFirst({
        where: {
          orderId,
          driverId,
          status: OrderAssignmentStatus.PENDING,
          expiresAt: { gt: new Date() },
        },
      });
      if (!asg) {
        throw new NotFoundException('No active offer for you on this order');
      }

      const otherPending = await tx.orderAssignment.findMany({
        where: {
          orderId,
          status: OrderAssignmentStatus.PENDING,
          id: { not: asg.id },
        },
        select: { id: true, driverId: true },
      });
      for (const o of otherPending) {
        await tx.orderAssignment.update({
          where: { id: o.id },
          data: { status: OrderAssignmentStatus.SUPERSEDED, decidedAt: new Date() },
        });
        await tx.driver.update({
          where: { id: o.driverId },
          data: { operationalStatus: DriverOperationalStatus.ONLINE_IDLE },
        });
      }

      const decided = new Date();
      await tx.orderAssignment.update({
        where: { id: asg.id },
        data: { status: OrderAssignmentStatus.ACCEPTED, decidedAt: decided },
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.ACCEPTED,
          assignedDriverId: driverId,
          acceptedAt: decided,
        },
      });

      const zone = order.serviceZoneId
        ? await tx.serviceZone.findUnique({
            where: { id: order.serviceZoneId },
            select: {
              starterFeeUzs: true,
              meterBaseUzs: true,
              waitingFreeMinutes: true,
              waitingFeePerMinuteUzs: true,
              slug: true,
            },
          })
        : null;

      const starterNum =
        order.starterFeeUzs != null
          ? Number(order.starterFeeUzs)
          : zone?.starterFeeUzs != null
            ? Number(zone.starterFeeUzs)
          : zone?.meterBaseUzs != null
            ? Number(zone.meterBaseUzs)
            : this.config.get<number>('METER_BASE_FARE_UZS', 5000);
      const freeWait = order.freeWaitMinutes ?? zone?.waitingFreeMinutes ?? 10;
      const waitPerMin =
        order.waitingFeePerMinuteUzs != null
          ? Number(order.waitingFeePerMinuteUzs)
          : zone?.waitingFeePerMinuteUzs != null
            ? Number(zone.waitingFeePerMinuteUzs)
            : 1000;

      const trip = await tx.trip.create({
        data: {
          orderId,
          driverId,
          status: TripStatus.NOT_STARTED,
          starterFeeUzs: new Prisma.Decimal(starterNum),
          freeWaitMinutes: freeWait,
          waitingFeePerMinuteUzs: new Prisma.Decimal(waitPerMin),
          distanceRateUzs: order.distanceRateUzs ?? undefined,
          pricingPlanId: order.pickupPricingZoneName ?? zone?.slug ?? null,
        },
      });

      await tx.tripEvent.create({
        data: {
          tripId: trip.id,
          type: TripEventType.TRIP_RESERVED,
          payload: { orderId, driverId } as object,
        },
      });

      await tx.driver.update({
        where: { id: driverId },
        data: { operationalStatus: DriverOperationalStatus.EN_ROUTE_PICKUP },
      });

      return { order: await tx.order.findUnique({ where: { id: orderId } }), trip, tripId: trip.id };
    });

    this.operatorGateway.emitOrderUpdate(result.order?.serviceZoneId ?? null, {
      type: 'accepted',
      orderId,
      driverId,
      tripId: result.tripId,
    });
    if (result.order) {
      void this.notify
        .onOrderAcceptedByDriver(
          {
            id: result.order.id,
            customerPhone: result.order.customerPhone,
            pickupLandmark: result.order.pickupLandmark,
          },
          driverId,
        )
        .catch((e) => this.log.warn(`Notify after accept: ${e instanceof Error ? e.message : e}`));
    }
    return result;
  }

  async rejectOrder(orderId: string, driverId: string, note?: string) {
    await this.expireStaleAssignments();
    const asg = await this.prisma.orderAssignment.findFirst({
      where: {
        orderId,
        driverId,
        status: OrderAssignmentStatus.PENDING,
      },
    });
    if (!asg) {
      throw new NotFoundException('No pending offer to reject');
    }
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    const now = new Date();
    await this.prisma.orderAssignment.update({
      where: { id: asg.id },
      data: { status: OrderAssignmentStatus.REJECTED, decidedAt: now, rejectNote: note },
    });
    await this.prisma.driver.update({
      where: { id: driverId },
      data: { operationalStatus: DriverOperationalStatus.ONLINE_IDLE },
    });
    this.operatorGateway.emitOrderUpdate(order.serviceZoneId, {
      type: 'rejected',
      orderId,
      driverId,
    });
    return { ok: true as const };
  }

  async getOrderByIdForOperator(orderId: string) {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        assignments: { orderBy: { offeredAt: 'desc' } },
        assignedDriver: { include: { user: { select: { phone: true } } } },
        serviceZone: true,
        trip: true,
        pricingProfile: true,
        pricingRing: true,
      },
    });
  }

  async listOrdersForOperator(serviceZoneId?: string, limit = 30) {
    return this.prisma.order.findMany({
      where: serviceZoneId ? { serviceZoneId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        assignedDriver: { select: { id: true } },
        pricingRing: true,
        trip: {
          select: {
            id: true,
            status: true,
            waitingStartedAt: true,
            waitingEndedAt: true,
            freeWaitMinutes: true,
            paidWaitMinutes: true,
            waitingFeeUzs: true,
            distanceMeters: true,
            distanceRateUzs: true,
            distanceFeeUzs: true,
            finalFareUzs: true,
            commissionUzs: true,
            netUzs: true,
            startedAt: true,
            endedAt: true,
          },
        },
      },
    });
  }
}
