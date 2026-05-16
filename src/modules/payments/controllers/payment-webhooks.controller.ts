import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { Public } from '../../../auth/decorators/public.decorator';
import { HandlePaymentWebhookUseCase } from '../application/use-cases/handle-payment-webhook.use-case';
import { VerifyPaymentWebhookRequestDto } from '../contracts/requests/verify-payment-webhook.request.dto';
import { PaymentWebhookResponseDto } from '../contracts/responses/payment-webhook.response.dto';

type RawBodyRequest = {
  rawBody?: Buffer;
  headers: Record<string, string | string[] | undefined>;
};

@Controller('payments/webhooks')
@UseGuards(JwtAuthGuard)
export class PaymentWebhooksController {
  constructor(
    private readonly handlePaymentWebhookUseCase: HandlePaymentWebhookUseCase,
  ) {}

  @Public()
  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  async handlePaystackWebhook(
    @Body() parsedBody: VerifyPaymentWebhookRequestDto,
    @Req() request: RawBodyRequest,
  ): Promise<PaymentWebhookResponseDto> {
    const rawBody = request.rawBody;

    if (!rawBody) {
      throw new BadRequestException(
        'Raw request body is required for webhook verification.',
      );
    }

    const result = await this.handlePaymentWebhookUseCase.execute({
      provider: 'paystack',
      rawBody,
      parsedBody,
      headers: request.headers,
    });

    return result;
  }

  @Public()
  @Post('mtn-momo')
  @HttpCode(HttpStatus.OK)
  async handleMtnMomoWebhook(
    @Body() parsedBody: VerifyPaymentWebhookRequestDto,
    @Req() request: RawBodyRequest,
  ): Promise<PaymentWebhookResponseDto> {
    const rawBody = request.rawBody;

    if (!rawBody) {
      throw new BadRequestException(
        'Raw request body is required for webhook verification.',
      );
    }

    return this.handlePaymentWebhookUseCase.execute({
      provider: 'momo',
      rawBody,
      parsedBody,
      headers: request.headers,
    });
  }
}