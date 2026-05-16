import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { AppPermission } from '../../../common/constants/permissions';
import { AuthUser } from '../../../common/types/auth-user.type';
import { requireIdempotencyKey } from '../../../shared/idempotency/idempotency-header.util';
import { GetPaymentIntentUseCase } from '../application/use-cases/get-payment-intent.use-case';
import { InitiatePaymentUseCase } from '../application/use-cases/initiate-payment.use-case';
import { InitiatePaymentRequestDto } from '../contracts/requests/initiate-payment.request.dto';
import { InitiatePaymentResponseDto } from '../contracts/responses/initiate-payment.response.dto';

@Controller('payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentsController {
  constructor(
    private readonly initiatePaymentUseCase: InitiatePaymentUseCase,
    private readonly getPaymentIntentUseCase: GetPaymentIntentUseCase,
  ) {}

  @Post('initiate')
  @Permissions(AppPermission.PAYMENT_INITIATE_OWN)
  async initiatePayment(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: InitiatePaymentRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() _user: AuthUser,
  ): Promise<InitiatePaymentResponseDto> {
    const result = await this.initiatePaymentUseCase.execute({
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      provider: body.provider,
      eventId: body.eventId,
      customerPhone: body.customerPhone ?? null,
    });

    return result;
  }

  @Get(':paymentIntentId')
  @Permissions(AppPermission.PAYMENT_READ_OWN)
  async getPaymentIntent(
    @Param('paymentIntentId', ParseUUIDPipe) paymentIntentId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<InitiatePaymentResponseDto> {
    return this.getPaymentIntentUseCase.execute({
      paymentIntentId,
      buyerUserId: user.id,
    });
  }
}