import { Injectable } from '@nestjs/common';
import { PaymentIntentView, PaymentsService } from '../payments.service';

@Injectable()
export class GetPaymentIntentUseCase {
  constructor(private readonly paymentsService: PaymentsService) {}

  async execute(input: {
    paymentIntentId: string;
    buyerUserId: string;
  }): Promise<PaymentIntentView> {
    return this.paymentsService.getPaymentIntentForBuyer(
      input.paymentIntentId,
      input.buyerUserId,
    );
  }
}