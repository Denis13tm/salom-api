import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DriverOperationalStatus,
  FareMode,
  OrderStatus,
  Prisma,
  TripEventType,
  TripStatus,
} from "@prisma/client";
import { distanceMetersHaversine } from "../common/haversine";
import { LedgerService } from "../ledger/ledger.service";
import { OrderLifecycleService } from "../orders/order-lifecycle.service";
import { OperationalNotificationsService } from "../notifications/operational-notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { OperatorGateway } from "../tracking/operator.gateway";
import { OpenDisputeDto } from "../orders/dto/open-dispute.dto";
import { ResolveDisputeDto } from "../orders/dto/resolve-dispute.dto";
import { CompleteTripDto } from "./dto/complete-trip.dto";
import { FareMeterService } from "./fare-meter.service";
import type { MeterConfigSnapshot } from "./fare-meter.service";

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operatorGateway: OperatorGateway,
    private readonly ledger: LedgerService,
    private readonly orderLifecycle: OrderLifecycleService,
    private readonly notify: OperationalNotificationsService,
    private readonly fareMeter: FareMeterService,
    private readonly config: ConfigService,
  ) {}

  async getActiveForDriver(driverId: string) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        driverId,
        status: {
          in: [TripStatus.NOT_STARTED, TripStatus.ACTIVE, TripStatus.DISPUTED],
        },
        order: {
          status: {
            notIn: [
              OrderStatus.COMPLETED,
              OrderStatus.CANCELLED_BY_OPERATOR,
              OrderStatus.CANCELLED_BY_DRIVER,
              OrderStatus.CANCELLED_BY_PASSENGER,
              OrderStatus.EXPIRED,
            ],
          },
        },
      },
      orderBy: { createdAt: "desc" },
      include: {
        order: { include: { serviceZone: true } },
      },
    });
    if (!trip) {
      return { activeTrip: null };
    }
    const fareMode = trip.order.fareMode;
    const starter = this.snapshotStarterUzs(trip);
    const waitingCommitted = Number(trip.waitingFeeUzs ?? 0);

    let metered: {
      billableMeters: number;
      estimatedFareUzs: number;
      starterFeeUzs: number;
      waitingFeeUzs: number;
      distanceFareEstimatedUzs: number;
      perKmUzs: number;
    } | null = null;

    if (fareMode === FareMode.METERED && trip.status === TripStatus.ACTIVE) {
      const perKm = trip.distanceRateUzs ?? trip.order.distanceRateUzs;
      const d = await this.fareMeter.computeDistanceFareOnlyForTrip(
        trip.id,
        perKm != null ? Number(perKm) : undefined,
      );
      const estimatedTotal = Math.round(
        starter + waitingCommitted + d.distanceFeeUzs,
      );
      metered = {
        billableMeters: d.billableMeters,
        estimatedFareUzs: estimatedTotal,
        starterFeeUzs: Math.round(starter),
        waitingFeeUzs: Math.round(waitingCommitted),
        distanceFareEstimatedUzs: d.distanceFeeUzs,
        perKmUzs: d.perKmUzs,
      };
    }

    if (
      fareMode === FareMode.METERED &&
      trip.status === TripStatus.NOT_STARTED
    ) {
      const perKm =
        trip.distanceRateUzs != null
          ? Number(trip.distanceRateUzs)
          : trip.order.distanceRateUzs != null
            ? Number(trip.order.distanceRateUzs)
            : await this.fareMeter.effectivePerKmUzs(trip.order.serviceZoneId);
      let waitingEst = 0;
      if (
        trip.order.status === OrderStatus.DRIVER_ARRIVING &&
        trip.waitingStartedAt &&
        trip.freeWaitMinutes != null
      ) {
        waitingEst = this.estimateWaitingFeeSoFar({
          waitingStartedAt: trip.waitingStartedAt,
          now: new Date(),
          freeWaitMinutes: trip.freeWaitMinutes,
          ratePerMin: Number(trip.waitingFeePerMinuteUzs ?? 1000),
        });
      }
      metered = {
        billableMeters: 0,
        estimatedFareUzs: Math.round(starter + waitingEst),
        starterFeeUzs: Math.round(starter),
        waitingFeeUzs: Math.round(waitingEst),
        distanceFareEstimatedUzs: 0,
        perKmUzs: perKm,
      };
    }

    let waitingLive: {
      waitingStartedAt: string;
      freeWaitMinutes: number;
      perMinuteUzs: number;
      accumulatedWaitingFeeEstimatedUzs: number;
      freeEndsAtEstimated?: string | null;
    } | null = null;
    if (
      trip.order.status === OrderStatus.DRIVER_ARRIVING &&
      trip.waitingStartedAt &&
      trip.freeWaitMinutes != null
    ) {
      const rate = Number(trip.waitingFeePerMinuteUzs ?? 1000);
      const acc = this.estimateWaitingFeeSoFar({
        waitingStartedAt: trip.waitingStartedAt,
        now: new Date(),
        freeWaitMinutes: trip.freeWaitMinutes,
        ratePerMin: rate,
      });
      const freeMs = trip.freeWaitMinutes * 60000;
      const freeEnds = new Date(trip.waitingStartedAt.getTime() + freeMs);
      waitingLive = {
        waitingStartedAt: trip.waitingStartedAt.toISOString(),
        freeWaitMinutes: trip.freeWaitMinutes,
        perMinuteUzs: rate,
        accumulatedWaitingFeeEstimatedUzs: acc,
        freeEndsAtEstimated: freeEnds.toISOString(),
      };
    }

    let meterSnap: MeterConfigSnapshot | null = null;
    if (fareMode === FareMode.METERED) {
      meterSnap = await this.fareMeter.configSnapshotForServiceZoneId(
        trip.order.serviceZoneId,
      );
    }

    return {
      activeTrip: {
        id: trip.id,
        status: trip.status,
        fareMode,
        meterSnap,
        order: {
          id: trip.order.id,
          status: trip.order.status,
          customerPhone: trip.order.customerPhone,
          pickupLandmark: trip.order.pickupLandmark,
          dropoffText: trip.order.dropoffText,
          operatorEnteredFareUzs:
            trip.order.operatorEnteredFareUzs?.toString() ?? null,
        },
        startedAt: trip.startedAt?.toISOString() ?? null,
        endedAt: trip.endedAt?.toISOString() ?? null,
        fareBreakdown: {
          starterFeeUzs: Math.round(starter),
          waitingFeeUzsCommitted: Math.round(waitingCommitted),
          pickupPricingPlanSlug: trip.pricingPlanId ?? null,
        },
        metered,
        waitingLive,
      },
    };
  }

  private snapshotStarterUzs(trip: {
    starterFeeUzs: Prisma.Decimal | null | undefined;
    order: {
      serviceZone?: {
        starterFeeUzs: Prisma.Decimal | null;
        meterBaseUzs: Prisma.Decimal | null;
      } | null;
    };
  }): number {
    if (trip.starterFeeUzs != null) {
      return Number(trip.starterFeeUzs);
    }
    const z = trip.order.serviceZone;
    if (z?.starterFeeUzs != null) return Number(z.starterFeeUzs);
    if (z?.meterBaseUzs != null) return Number(z.meterBaseUzs);
    return this.config.get<number>("METER_BASE_FARE_UZS", 5000);
  }

  private estimateWaitingFeeSoFar(opts: {
    waitingStartedAt: Date;
    now: Date;
    freeWaitMinutes: number;
    ratePerMin: number;
  }): number {
    const elapsedMs = opts.now.getTime() - opts.waitingStartedAt.getTime();
    const totalMinUp = Math.max(0, Math.ceil(elapsedMs / 60000));
    const paidMin = Math.max(0, totalMinUp - opts.freeWaitMinutes);
    return paidMin * opts.ratePerMin;
  }

  private async mustOwnTrip(tripId: string, driverId: string) {
    const t = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        order: {
          include: {
            serviceZone: {
              select: { starterFeeUzs: true, meterBaseUzs: true },
            },
          },
        },
      },
    });
    if (!t) throw new NotFoundException("Trip not found");
    if (t.driverId !== driverId) {
      throw new ForbiddenException();
    }
    return t;
  }

  private async assertNearPickupIfCoords(
    driverId: string,
    orderId: string,
    pickupLat: Prisma.Decimal | null | undefined,
    pickupLng: Prisma.Decimal | null | undefined,
  ) {
    if (pickupLat == null || pickupLng == null) {
      return;
    }
    const radius = this.config.get<number>("PICKUP_NEARBY_RADIUS_M", 180);
    const ping = await this.prisma.locationPing.findFirst({
      where: { driverId, orderId },
      orderBy: { recordedAt: "desc" },
    });
    if (!ping) {
      throw new BadRequestException(
        "Joylashuv aniqlanmadi. GPS yoqilganini tekshirib, qayta urinib ko‘ring.",
      );
    }
    const dist = distanceMetersHaversine(
      Number(ping.lat),
      Number(ping.lng),
      Number(pickupLat),
      Number(pickupLng),
    );
    if (dist > radius) {
      throw new BadRequestException(
        `Mo‘ljalgacha taxminiy ${radius} m ichida bo‘lishingiz kerak (GPS: ~${Math.round(dist)} m).`,
      );
    }
  }

  /** Picked up nuqtasida — kutish taymeri boshlanadi; pickup koordinata bo‘lsa yaqinlik tekshiriladi. */
  async markPickupArrived(tripId: string, driverId: string) {
    const t = await this.mustOwnTrip(tripId, driverId);
    if (t.status === TripStatus.DISPUTED) {
      throw new ConflictException("Trip is DISPUTED");
    }
    if (t.status !== TripStatus.NOT_STARTED) {
      throw new ConflictException("Trip is not in NOT_STARTED");
    }
    if (t.order.status !== OrderStatus.ACCEPTED) {
      throw new ConflictException(
        `Order must be ACCEPTED, got ${t.order.status}`,
      );
    }
    await this.assertNearPickupIfCoords(
      driverId,
      t.order.id,
      t.order.pickupLat,
      t.order.pickupLng,
    );
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.tripEvent.create({
        data: {
          tripId,
          type: TripEventType.DRIVER_ARRIVED_AT_PICKUP,
          payload: { at: now.toISOString() },
        },
      }),
      this.prisma.trip.update({
        where: { id: tripId },
        data: { waitingStartedAt: now },
      }),
      this.prisma.order.update({
        where: { id: t.orderId },
        data: { status: OrderStatus.DRIVER_ARRIVING },
      }),
      this.prisma.driver.update({
        where: { id: driverId },
        data: { operationalStatus: DriverOperationalStatus.ARRIVED_PICKUP },
      }),
    ]);
    this.emit(t.order.serviceZoneId, {
      type: "pickup_arrived",
      orderId: t.orderId,
      tripId,
      driverId,
    });
    return {
      ok: true as const,
      order: await this.prisma.order.findUnique({ where: { id: t.orderId } }),
    };
  }

  /** Safar boshlash: kutish narxi hisoblanadi; Trip ACTIVE. */
  async startTrip(tripId: string, driverId: string) {
    const t = await this.mustOwnTrip(tripId, driverId);
    if (t.status === TripStatus.DISPUTED) {
      throw new ConflictException("Trip is DISPUTED");
    }
    if (t.status !== TripStatus.NOT_STARTED) {
      throw new ConflictException("Trip is not in NOT_STARTED");
    }
    if (t.order.status !== OrderStatus.DRIVER_ARRIVING) {
      throw new ConflictException(
        `Order must be DRIVER_ARRIVING, got ${t.order.status}`,
      );
    }
    const now = new Date();
    if (!t.waitingStartedAt) {
      throw new ConflictException(
        "Kutish boshlanmagan: avval «Mo‘ljalga keldim»",
      );
    }
    const freeM = t.freeWaitMinutes ?? 10;
    const rate = Number(t.waitingFeePerMinuteUzs ?? 1000);
    const elapsedMs = now.getTime() - t.waitingStartedAt.getTime();
    const totalMinUp = Math.max(0, Math.ceil(elapsedMs / 60000));
    const paidMin = Math.max(0, totalMinUp - freeM);
    const waitingFee = paidMin * rate;

    await this.prisma.$transaction([
      this.prisma.trip.update({
        where: { id: tripId },
        data: {
          status: TripStatus.ACTIVE,
          startedAt: now,
          waitingEndedAt: now,
          freeWaitMinutes: freeM,
          paidWaitMinutes: paidMin,
          waitingFeeUzs: new Prisma.Decimal(waitingFee),
        },
      }),
      this.prisma.order.update({
        where: { id: t.orderId },
        data: { status: OrderStatus.PASSENGER_ONBOARD },
      }),
      this.prisma.driver.update({
        where: { id: driverId },
        data: { operationalStatus: DriverOperationalStatus.IN_TRIP },
      }),
      this.prisma.tripEvent.create({
        data: {
          tripId,
          type: TripEventType.PASSENGER_ONBOARD,
          payload: { at: now.toISOString() },
        },
      }),
      this.prisma.tripEvent.create({
        data: {
          tripId,
          type: TripEventType.TRIP_STARTED,
          payload: { at: now.toISOString() },
        },
      }),
    ]);
    this.emit(t.order.serviceZoneId, {
      type: "trip_started",
      orderId: t.orderId,
      tripId,
      driverId,
    });
    return { ok: true as const };
  }

  async openDispute(tripId: string, driverId: string, body: OpenDisputeDto) {
    const t = await this.mustOwnTrip(tripId, driverId);
    if (t.status === TripStatus.DISPUTED) {
      throw new ConflictException("Dispute already open");
    }
    if (t.status !== TripStatus.NOT_STARTED && t.status !== TripStatus.ACTIVE) {
      throw new ConflictException(
        "Trip must be NOT_STARTED or ACTIVE to open dispute",
      );
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.trip.update({
        where: { id: tripId },
        data: { status: TripStatus.DISPUTED, disputeNote: body.note },
      }),
      this.prisma.tripEvent.create({
        data: {
          tripId,
          type: TripEventType.DISPUTE_OPENED,
          payload: { at: now.toISOString(), note: body.note },
        },
      }),
    ]);
    this.emit(t.order.serviceZoneId, {
      type: "dispute_opened",
      orderId: t.orderId,
      tripId,
      driverId,
      note: body.note,
    });
    return {
      ok: true as const,
      trip: await this.prisma.trip.findUnique({ where: { id: tripId } }),
    };
  }

  async resolveDispute(
    tripId: string,
    operatorId: string,
    body: ResolveDisputeDto,
  ) {
    const t = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { order: true },
    });
    if (!t) {
      throw new NotFoundException("Trip not found");
    }
    if (t.status !== TripStatus.DISPUTED) {
      throw new ConflictException("Trip is not DISPUTED");
    }
    if (body.outcome === "cancel") {
      return this.orderLifecycle.cancelByOperator(t.orderId, operatorId, {
        cancelNote: "dispute_resolved_cancel",
      });
    }
    if (t.order.status !== OrderStatus.PASSENGER_ONBOARD) {
      throw new BadRequestException(
        "Complete-from-dispute only when passenger was onboard (PASSENGER_ONBOARD)",
      );
    }
    const rawFare = body.fareUzs ?? 0;
    return this.completeTrip(
      t.id,
      t.driverId,
      { fareUzs: rawFare },
      { asOperatorFromDispute: true },
    );
  }

  async completeTrip(
    tripId: string,
    driverId: string,
    body: CompleteTripDto,
    opts?: { asOperatorFromDispute?: boolean },
  ) {
    const t = await this.mustOwnTrip(tripId, driverId);
    if (t.status === TripStatus.DISPUTED && !opts?.asOperatorFromDispute) {
      throw new ConflictException(
        "Dispute is open: complete only via operator resolution",
      );
    }
    const isActive = t.status === TripStatus.ACTIVE;
    const isOperatorCloseDispute =
      t.status === TripStatus.DISPUTED &&
      t.order.status === OrderStatus.PASSENGER_ONBOARD &&
      Boolean(opts?.asOperatorFromDispute);
    if (!isActive && !isOperatorCloseDispute) {
      if (t.status === TripStatus.DISPUTED) {
        throw new ConflictException(
          "Dispute: cannot complete this trip state from driver app",
        );
      }
      throw new ConflictException("Trip is not ACTIVE");
    }
    if (t.order.status !== OrderStatus.PASSENGER_ONBOARD) {
      throw new ConflictException(
        `Order must be PASSENGER_ONBOARD, got ${t.order.status}`,
      );
    }
    const now = new Date();
    const order = await this.prisma.order.findUnique({
      where: { id: t.orderId },
    });
    if (!order) throw new NotFoundException("Order");

    const starter = Math.round(this.snapshotStarterUzs(t));
    const waiting = Math.round(Number(t.waitingFeeUzs ?? 0));

    /** Operator nizo yechimi: `fareUzs` yakuniy to‘langan summa deb qabul qilinadi (boshqa qatlamlarni qayta qo‘shmaymiz). */
    if (opts?.asOperatorFromDispute && body.fareUzs != null) {
      const absolute = Math.round(body.fareUzs);
      const split = await this.ledger.splitGrossUzsIntAsync(absolute);
      const farePayload = {
        starterFeeUzs: "(operator)",
        waitingFeeUzs: "(operator)",
        rideFareUzs: "(operator)",
        finalFareUzs: String(split.gross),
      };
      const out = await this.prisma.$transaction(async (tx) => {
        await tx.trip.update({
          where: { id: tripId },
          data: {
            status: TripStatus.COMPLETED,
            endedAt: now,
            grossUzs: split.gross,
            commissionUzs: split.commission,
            netUzs: split.net,
            finalFareUzs: split.gross,
          },
        });
        await tx.order.update({
          where: { id: t.orderId },
          data: { status: OrderStatus.COMPLETED },
        });
        const wallet = await this.ledger.recordTripCompletion(tx, {
          driverId,
          orderId: t.orderId,
          tripId,
          split,
        });
        await tx.tripEvent.create({
          data: {
            tripId,
            type: TripEventType.TRIP_ENDED,
            payload: {
              at: now.toISOString(),
              fareBreakdown: farePayload,
              disputeResolved: true,
              grossUzs: split.gross.toString(),
            },
          },
        });
        await tx.tripEvent.create({
          data: {
            tripId,
            type: TripEventType.FARE_FINALIZED,
            payload: {
              fareBreakdown: farePayload,
              disputeResolved: true,
              grossUzs: split.gross.toString(),
            },
          },
        });
        return { split, newBalance: wallet.newBalance };
      });
      this.emit(t.order.serviceZoneId ?? null, {
        type: "trip_completed",
        orderId: t.orderId,
        tripId,
        driverId,
        grossUzs: out.split.gross.toString(),
        disputeResolved: true,
      });
      try {
        await this.notify.onTripCompleted(
          { id: t.orderId, customerPhone: order.customerPhone },
          out.split.gross.toString(),
        );
      } catch {
        /* SMS xato */
      }
      return {
        ok: true as const,
        grossUzs: out.split.gross.toString(),
        fareBreakdown: farePayload,
        commissionUzs: out.split.commission.toString(),
        netUzs: out.split.net.toString(),
        newBalanceUzs: out.newBalance.toString(),
        rateBps: out.split.rateBps,
      };
    }

    let manualRide = 0;
    let distanceMeters: Prisma.Decimal | null = null;
    let distanceFeeUzs: Prisma.Decimal | null = null;

    let rateForTrip: Prisma.Decimal | null =
      t.distanceRateUzs ?? order.distanceRateUzs ?? null;

    if (order.fareMode === FareMode.METERED) {
      const dist = await this.fareMeter.computeDistanceFareOnlyForTrip(
        tripId,
        rateForTrip != null ? Number(rateForTrip) : undefined,
      );
      manualRide = dist.distanceFeeUzs;
      distanceMeters = new Prisma.Decimal(dist.billableMeters);
      distanceFeeUzs = new Prisma.Decimal(dist.distanceFeeUzs);
      rateForTrip = new Prisma.Decimal(dist.perKmUzs);
    } else if (body.fareUzs != null) {
      manualRide = body.fareUzs;
    } else if (order.operatorEnteredFareUzs) {
      manualRide = Number(order.operatorEnteredFareUzs);
    } else {
      manualRide = 0;
    }

    const finalFare = Math.round(starter + waiting + manualRide);
    const split = await this.ledger.splitGrossUzsIntAsync(finalFare);

    const farePayload = {
      starterFeeUzs: String(starter),
      waitingFeeUzs: String(waiting),
      rideFareUzs: String(manualRide),
      finalFareUzs: String(split.gross),
    };

    const out = await this.prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id: tripId },
        data: {
          status: TripStatus.COMPLETED,
          endedAt: now,
          grossUzs: split.gross,
          commissionUzs: split.commission,
          netUzs: split.net,
          manualFareUzs:
            order.fareMode === FareMode.METERED
              ? null
              : new Prisma.Decimal(manualRide),
          distanceMeters,
          distanceRateUzs:
            order.fareMode === FareMode.METERED ? rateForTrip : null,
          distanceFeeUzs:
            order.fareMode === FareMode.METERED ? distanceFeeUzs : null,
          finalFareUzs: split.gross,
        },
      });
      await tx.order.update({
        where: { id: t.orderId },
        data: { status: OrderStatus.COMPLETED },
      });
      const wallet = await this.ledger.recordTripCompletion(tx, {
        driverId,
        orderId: t.orderId,
        tripId,
        split,
      });
      await tx.tripEvent.create({
        data: {
          tripId,
          type: TripEventType.TRIP_ENDED,
          payload: {
            at: now.toISOString(),
            fareBreakdown: farePayload,
            grossUzs: split.gross.toString(),
            commissionUzs: split.commission.toString(),
            netUzs: split.net.toString(),
          },
        },
      });
      await tx.tripEvent.create({
        data: {
          tripId,
          type: TripEventType.FARE_FINALIZED,
          payload: {
            fareBreakdown: farePayload,
            grossUzs: split.gross.toString(),
            rateBps: split.rateBps,
            netUzs: split.net.toString(),
          },
        },
      });
      return { split, newBalance: wallet.newBalance };
    });

    this.emit(t.order.serviceZoneId, {
      type: "trip_completed",
      orderId: t.orderId,
      tripId,
      driverId,
      grossUzs: out.split.gross.toString(),
      fareBreakdown: farePayload,
      commissionUzs: out.split.commission.toString(),
      netUzs: out.split.net.toString(),
      newBalanceUzs: out.newBalance.toString(),
      rateBps: out.split.rateBps,
    });
    try {
      await this.notify.onTripCompleted(
        { id: t.orderId, customerPhone: order.customerPhone },
        out.split.gross.toString(),
      );
    } catch {
      /* SMS xato */
    }
    return {
      ok: true as const,
      grossUzs: out.split.gross.toString(),
      fareBreakdown: farePayload,
      commissionUzs: out.split.commission.toString(),
      netUzs: out.split.net.toString(),
      newBalanceUzs: out.newBalance.toString(),
      rateBps: out.split.rateBps,
    };
  }

  async listDisputedForOperator(serviceZoneId?: string) {
    const where: Prisma.TripWhereInput = { status: TripStatus.DISPUTED };
    if (serviceZoneId?.trim()) {
      where.order = { serviceZoneId: serviceZoneId.trim() };
    }
    const rows = await this.prisma.trip.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        order: {
          select: {
            id: true,
            status: true,
            customerPhone: true,
            pickupLandmark: true,
            serviceZoneId: true,
          },
        },
        driver: { include: { user: { select: { phone: true } } } },
      },
    });
    return rows.map((trip) => ({
      tripId: trip.id,
      updatedAt: trip.updatedAt.toISOString(),
      disputeNote: trip.disputeNote,
      driverPhone: trip.driver.user.phone,
      customerPhone: trip.order.customerPhone,
      pickupLandmark: trip.order.pickupLandmark,
      orderId: trip.order.id,
      orderStatus: trip.order.status,
    }));
  }

  async listHistoryForDriver(driverId: string, take: number) {
    const n = Math.min(Math.max(take, 1), 50);
    const rows = await this.prisma.trip.findMany({
      where: { driverId, status: TripStatus.COMPLETED },
      orderBy: { endedAt: "desc" },
      take: n,
      include: {
        order: {
          select: { id: true, customerPhone: true, pickupLandmark: true },
        },
      },
    });
    return {
      items: rows.map((trip) => ({
        id: trip.id,
        status: trip.status,
        endedAt: trip.endedAt?.toISOString() ?? null,
        grossUzs: trip.grossUzs?.toString() ?? null,
        finalFareUzs: trip.finalFareUzs?.toString() ?? null,
        order: trip.order,
      })),
    };
  }

  private emit(serviceZoneId: string | null, payload: object) {
    this.operatorGateway.emitOrderUpdate(serviceZoneId, payload);
  }
}
