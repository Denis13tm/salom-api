import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DriverOperationalStatus,
  OrderAssignmentStatus,
  OrderStatus,
  Prisma,
  TripEventType,
  TripStatus,
} from '@prisma/client';
import { OperationalNotificationsService } from '../notifications/operational-notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { OperatorGateway } from '../tracking/operator.gateway';
import { DriverGateway } from '../driver-ws/driver.gateway';

const TERMINAL: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED_BY_OPERATOR,
  OrderStatus.CANCELLED_BY_DRIVER,
  OrderStatus.CANCELLED_BY_PASSENGER,
  OrderStatus.EXPIRED,
]);

@Injectable()
export class OrderLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operatorGateway: OperatorGateway,
    private readonly driverGateway: DriverGateway,
    private readonly notify: OperationalNotificationsService,
  ) {}

  private async supersedePendingAssignments(
    tx: Prisma.TransactionClient,
    orderId: string,
    now: Date,
  ) {
    const pending = await tx.orderAssignment.findMany({
      where: { orderId, status: OrderAssignmentStatus.PENDING },
      select: { id: true, driverId: true },
    });
    for (const p of pending) {
      await tx.orderAssignment.update({
        where: { id: p.id },
        data: { status: OrderAssignmentStatus.SUPERSEDED, decidedAt: now },
      });
      await tx.driver.updateMany({
        where: { id: p.driverId, operationalStatus: DriverOperationalStatus.ORDER_OFFERED },
        data: { operationalStatus: DriverOperationalStatus.ONLINE_IDLE },
      });
    }
  }

  private idleDriverIfWasAssigned(driverId: string | null | undefined) {
    if (!driverId) return;
    return {
      where: { id: driverId },
      data: { operationalStatus: DriverOperationalStatus.ONLINE_IDLE } as const,
    };
  }

  /**
   * Operator bekor: CREATED..PASSENGER_ONBOARD (COMPLETED/terminal emas).
   */
  async cancelByOperator(
    orderId: string,
    _operatorId: string,
    input: { cancellationReasonId?: string; cancelNote?: string },
  ) {
    const out = await this.applyTerminalCancel(orderId, {
      targetStatus: OrderStatus.CANCELLED_BY_OPERATOR,
      ...input,
    });
    const phone = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerPhone: true },
    });
    if (phone) {
      try {
        await this.notify.onOrderCancelled(phone);
      } catch {
        /* */
      }
    }
    return out;
  }

  /**
   * Haydovchi bekor: faqat o‘z buyurtmasi, ACCEPTED / DRIVER_ARRIVING / PASSENGER_ONBOARD.
   */
  async cancelByDriver(
    orderId: string,
    driverId: string,
    input: { cancellationReasonId?: string; cancelNote?: string },
  ) {
    const o = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!o) throw new NotFoundException('Order');
    if (o.assignedDriverId !== driverId) {
      throw new ForbiddenException('Not your order');
    }
    if (TERMINAL.has(o.status)) {
      throw new ConflictException('Order already closed');
    }
    if (o.status === OrderStatus.CREATED || o.status === OrderStatus.BROADCASTED) {
      throw new BadRequestException('Driver cannot cancel before acceptance');
    }
    const out = await this.applyTerminalCancel(orderId, {
      targetStatus: OrderStatus.CANCELLED_BY_DRIVER,
      ...input,
    });
    const phone = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerPhone: true },
    });
    if (phone) {
      try {
        await this.notify.onOrderCancelled(phone);
      } catch {
        /* */
      }
    }
    return out;
  }

  /**
   * Yo‘lovchi kelmadi: faqat pickup kutish, DRIVER_ARRIVING + safar hali boshlanmagan.
   */
  async markPassengerNoShow(
    orderId: string,
    actor: { type: 'operator' } | { type: 'driver'; driverId: string },
    input: { cancellationReasonId?: string; cancelNote?: string },
  ) {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { trip: true },
    });
    if (!o) throw new NotFoundException('Order');
    if (o.status !== OrderStatus.DRIVER_ARRIVING) {
      throw new ConflictException('No-show only when DRIVER_ARRIVING');
    }
    if (!o.trip || o.trip.status !== TripStatus.NOT_STARTED) {
      throw new ConflictException('Trip must exist and be NOT_STARTED');
    }
    if (actor.type === 'driver' && o.assignedDriverId !== actor.driverId) {
      throw new ForbiddenException('Not your order');
    }
    let reasonId = input.cancellationReasonId;
    if (!reasonId) {
      const r = await this.prisma.cancellationReason.findUnique({ where: { code: 'passenger_no_show' } });
      if (r) reasonId = r.id;
    }
    const out = await this.applyTerminalCancel(orderId, {
      targetStatus: OrderStatus.CANCELLED_BY_PASSENGER,
      cancellationReasonId: reasonId,
      cancelNote: input.cancelNote ?? 'passenger_no_show',
    });
    const fresh = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerPhone: true },
    });
    if (fresh) {
      try {
        await this.notify.onPassengerNoShow(fresh);
      } catch {
        /* SMS xato bekor qilmaydi */
      }
    }
    return out;
  }

  private async applyTerminalCancel(
    orderId: string,
    input: { targetStatus: OrderStatus; cancellationReasonId?: string; cancelNote?: string },
  ) {
    const now = new Date();
    const out = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { trip: true },
      });
      if (!order) {
        throw new NotFoundException('Order');
      }
      if (TERMINAL.has(order.status)) {
        throw new ConflictException('Order already closed');
      }
      if (order.status === OrderStatus.COMPLETED) {
        throw new ConflictException('Cannot cancel completed order');
      }

      await this.supersedePendingAssignments(tx, orderId, now);

      if (order.trip) {
        if (order.trip.status === TripStatus.COMPLETED) {
          throw new ConflictException('Trip already completed');
        }
        if (order.trip.status !== TripStatus.CANCELLED) {
          await tx.trip.update({
            where: { id: order.trip.id },
            data: { status: TripStatus.CANCELLED, endedAt: now },
          });
          await tx.tripEvent.create({
            data: {
              tripId: order.trip.id,
              type: TripEventType.NOTE,
              payload: { kind: 'order_cancelled', at: now.toISOString() } as object,
            },
          });
        }
      }

      const idle = this.idleDriverIfWasAssigned(order.assignedDriverId);
      if (idle) {
        await tx.driver.update(idle);
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status: input.targetStatus,
          cancellationReasonId: input.cancellationReasonId,
          cancelNote: input.cancelNote,
        },
      });
      return { order: updated, hadTrip: Boolean(order.trip) };
    });

    this.operatorGateway.emitOrderUpdate(out.order.serviceZoneId, {
      type: 'order_cancelled',
      orderId,
      status: out.order.status,
    });
    if (out.order.assignedDriverId) {
      this.driverGateway.emitOrderCancelled(out.order.assignedDriverId, { orderId, status: out.order.status });
      try {
        await this.notify.notifyDriverOrderCancelled(out.order.assignedDriverId, orderId);
      } catch {
        /* */
      }
    }

    return { ok: true as const, order: out.order };
  }

  listCancellationReasons() {
    return this.prisma.cancellationReason.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, labelUz: true, sortOrder: true },
    });
  }
}
