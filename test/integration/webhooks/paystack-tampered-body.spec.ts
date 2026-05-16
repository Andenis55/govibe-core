import { createHmac } from 'node:crypto';
import request = require('supertest');
import {
  createPaystackSignatureTestApp,
  PaystackSignatureTestApp,
} from './support/paystack-signature-test-app';

describe('paystack webhook tampered body', () => {
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

  it('rejects tampered body with reused signature', async () => {
    const original = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'ref-123',
        status: 'success',
        amount: 12000,
        currency: 'GHS',
      },
    });

    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(Buffer.from(original))
      .digest('hex');

    const tampered = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'ref-123',
        status: 'failed',
        amount: 12000,
        currency: 'GHS',
      },
    });

    await request(harness.app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(tampered)
      .expect(401);

    expect(harness.verifyPaymentUseCase.execute).not.toHaveBeenCalled();
  });
});