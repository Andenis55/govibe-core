import { Injectable } from '@nestjs/common';
import {
  InitiatePaymentInput,
  PaymentIntentView,
  PaymentsService,
} from '../payments.service';

@Injectable()
export class InitiatePaymentUseCase {
  constructor(private readonly paymentsService: PaymentsService) {}

  async execute(input: InitiatePaymentInput): Promise<PaymentIntentView> {
    return this.paymentsService.initiatePayment(input);
  }
}
