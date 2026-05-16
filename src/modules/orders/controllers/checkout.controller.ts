import {
  Body,
  Controller,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/types/auth-user.type';
import { requireIdempotencyKey } from '../../../shared/idempotency/idempotency-header.util';
import { CreateOrderUseCase } from '../application/use-cases/create-order.use-case';
import { CreateOrderRequestDto } from '../contracts/requests/create-order.request.dto';
import { CreateOrderResponseDto } from '../contracts/responses/create-order.response.dto';

@Controller('checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(private readonly createOrderUseCase: CreateOrderUseCase) {}

  @Post('order')
  async createOrder(
    @Body() body: CreateOrderRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() _user: AuthUser,
  ): Promise<CreateOrderResponseDto> {
    const result = await this.createOrderUseCase.execute({
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      reservationId: body.reservationId,
      totalAmount: BigInt(body.totalAmountMinor),
      currency: body.currency,
    });

    return {
      orderId: result.orderId,
      status: result.status,
    };
  }
}