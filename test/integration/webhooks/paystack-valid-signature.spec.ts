import { createHmac } from 'node:crypto';
import request = require('supertest');
import {
  createPaystackSignatureTestApp,
  PaystackSignatureTestApp,
} from './support/paystack-signature-test-app';

describe('paystack webhook valid signature', () => {
  let harness: PaystackSignatureTestApp;

  beforeEach(async () => {
    harness = await createPaystackSignatureTestApp();
    harness.verifyPaymentUseCase.execute.mockResolvedValue({
      paymentId: 'payment-1',
      orderId: 'order-1',
      paymentStatus: 'SUCCESS',
      orderStatus: 'PAID',
    });
    harness.redisService.setIfNotExists.mockResolvedValue(true);
    harness.redisService.delete.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await harness.close();
  });

  it('accepts request with valid signature', async () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'known-ref-1',
        status: 'success',
        amount: 12000,
        currency: 'GHS',
      },
    });

    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(Buffer.from(body))
      .digest('hex');

    await request(harness.app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    expect(harness.verifyPaymentUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'paystack',
        providerRef: 'known-ref-1',
        verifiedSuccess: true,
        verifiedCurrency: 'GHS',
      }),
    );
  });
});