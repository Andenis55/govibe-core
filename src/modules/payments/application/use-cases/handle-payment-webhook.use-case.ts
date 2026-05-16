import { Injectable } from '@nestjs/common';
import {
  PaymentVerificationService,
  PaymentWebhookInput,
  PaymentWebhookResult,
} from '../payment-verification.service';
import { SupportedPaymentProvider } from '../../../../shared/constants/payment.constants';

export type HandlePaymentWebhookInput = {
  provider: SupportedPaymentProvider;
  rawBody: Buffer;
  parsedBody: PaymentWebhookInput['parsedBody'];
  headers: PaymentWebhookInput['headers'];
};

@Injectable()
export class HandlePaymentWebhookUseCase {
  constructor(
    private readonly paymentVerificationService: PaymentVerificationService,
  ) {}

  async execute(
    input: HandlePaymentWebhookInput,
  ): Promise<PaymentWebhookResult> {
    return this.paymentVerificationService.handleWebhook(input);
  }
}
