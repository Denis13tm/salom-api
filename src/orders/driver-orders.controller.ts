import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SalomDriverGuard } from "../tracking/guards/salom-driver.guard";
import { SalomDriverOperationalGuard } from "../tracking/guards/salom-driver-operational.guard";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { DispatchService } from "./dispatch.service";
import { OrderLifecycleService } from "./order-lifecycle.service";
import { RejectOrderDto } from "./dto/reject-order.dto";

@Controller({ path: "drivers/me/orders", version: "1" })
@UseGuards(SalomDriverGuard, SalomDriverOperationalGuard)
export class DriverOrdersController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  @Get("offer")
  getOffer(@Req() req: Request) {
    return this.dispatch.getCurrentOffer(req.salomDriverId!);
  }

  @Post(":orderId/accept")
  accept(@Param("orderId") orderId: string, @Req() req: Request) {
    return this.dispatch.acceptOrder(orderId, req.salomDriverId!);
  }

  @Post(":orderId/reject")
  reject(
    @Param("orderId") orderId: string,
    @Req() req: Request,
    @Body() body: RejectOrderDto,
  ) {
    return this.dispatch.rejectOrder(
      orderId,
      req.salomDriverId!,
      body.rejectNote,
    );
  }

  @Post(":orderId/cancel")
  cancel(
    @Param("orderId") orderId: string,
    @Req() req: Request,
    @Body() body: CancelOrderDto,
  ) {
    return this.lifecycle.cancelByDriver(orderId, req.salomDriverId!, body);
  }

  @Post(":orderId/passenger-no-show")
  passengerNoShow(
    @Param("orderId") orderId: string,
    @Req() req: Request,
    @Body() body: CancelOrderDto,
  ) {
    return this.lifecycle.markPassengerNoShow(
      orderId,
      { type: "driver", driverId: req.salomDriverId! },
      body,
    );
  }
}
