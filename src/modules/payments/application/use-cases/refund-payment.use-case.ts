import { Inject, Injectable } from '@nestjs/common';
import { PaymentProvider } from '../../domain/providers/payment-provider.interface';
import { MOMO_PROVIDER, PAYSTACK_PROVIDER } from '../../payments.tokens';
import { InvalidStateTransitionError } from '../../../../shared/errors/domain-errors';

@Injectable()
export class RefundPaymentUseCase {
  constructor(
    @Inject(PAYSTACK_PROVIDER)
    private readonly paystackProvider: PaymentProvider,
    @Inject(MOMO_PROVIDER)
    private readonly momoProvider: PaymentProvider,
  ) {}

  async execute(_input: unknown): Promise<void> {
    void this.paystackProvider;
    void this.momoProvider;

    throw new InvalidStateTransitionError(
      'Refund flow is not implemented yet.',
    );
  }
}
