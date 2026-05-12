import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { DispatchService } from "./dispatch.service";
import { BroadcastOrderDto } from "./dto/broadcast-order.dto";
import { CreateOrderDto } from "./dto/create-order.dto";
import { OrderLifecycleService } from "./order-lifecycle.service";
import { SalomOperatorGuard } from "./guards/salom-operator.guard";

@Controller({ path: "operator/orders", version: "1" })
@UseGuards(SalomOperatorGuard)
export class OperatorOrdersController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  @Get("meta/cancellation-reasons")
  cancellationReasons() {
    return this.lifecycle.listCancellationReasons();
  }

  @Post()
  create(@Body() body: CreateOrderDto, @Req() req: Request) {
    const opId = req.salomOperatorId!;
    return this.dispatch.createOrder(body, opId);
  }

  @Get()
  list(@Query("serviceZoneId") serviceZoneId?: string) {
    return this.dispatch.listOrdersForOperator(serviceZoneId);
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.dispatch.getOrderByIdForOperator(id);
  }

  @Post(":id/broadcast")
  broadcast(@Param("id") id: string, @Body() body: BroadcastOrderDto) {
    return this.dispatch.broadcastOrder(id, body);
  }

  @Post(":id/cancel")
  cancel(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() body: CancelOrderDto,
  ) {
    return this.lifecycle.cancelByOperator(id, req.salomOperatorId!, body);
  }

  @Post(":id/passenger-no-show")
  passengerNoShow(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() body: CancelOrderDto,
  ) {
    return this.lifecycle.markPassengerNoShow(id, { type: "operator" }, body);
  }
}
