import { Injectable } from "@nestjs/common";
import { PushService } from "./push.service";
import { SmsService } from "./sms.service";

/** Dispatch/trips lifecycle bo‘yicha shablonlar (Phase 8). */
@Injectable()
export class OperationalNotificationsService {
  constructor(
    private readonly sms: SmsService,
    private readonly push: PushService,
  ) {}

  async onOrderBroadcast(order: {
    id: string;
    customerPhone: string;
    pickupLandmark: string;
  }) {
    const body = await this.sms.buildCustomerMessage("order_broadcast", {
      pickupLandmark: order.pickupLandmark,
    });
    await this.sms.sendToCustomer(order.id, order.customerPhone, body);
  }

  async onOrderAcceptedByDriver(
    order: { id: string; customerPhone: string; pickupLandmark: string },
    driverId: string,
  ) {
    const body = await this.sms.buildCustomerMessage("order_accepted", {
      pickupLandmark: order.pickupLandmark,
    });
    await this.sms.sendToCustomer(order.id, order.customerPhone, body);
    await this.push.notifyDriver(
      driverId,
      order.id,
      "order_assigned",
      "Yangi buyurtma sizga biriktirildi.",
      { orderId: order.id },
    );
  }

  async onOrderCancelled(order: { id: string; customerPhone: string }) {
    const body = await this.sms.buildCustomerMessage("order_cancelled", {});
    await this.sms.sendToCustomer(order.id, order.customerPhone, body);
  }

  async onPassengerNoShow(order: { id: string; customerPhone: string }) {
    const body = await this.sms.buildCustomerMessage("passenger_no_show", {});
    await this.sms.sendToCustomer(order.id, order.customerPhone, body);
  }

  async onTripCompleted(
    order: { id: string; customerPhone: string },
    grossUzs: string,
  ) {
    const body = await this.sms.buildCustomerMessage("trip_completed", {
      grossUzs,
    });
    await this.sms.sendToCustomer(order.id, order.customerPhone, body);
  }

  async notifyDriverOrderCancelled(driverId: string, orderId: string) {
    await this.push.notifyDriver(
      driverId,
      orderId,
      "order_cancelled",
      "Buyurtma bekor qilindi.",
      { orderId },
    );
  }
}
