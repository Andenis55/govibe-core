import { createHmac } from 'node:crypto';
import request = require('supertest');
import { NotFoundError } from '../../../src/shared/errors/domain-errors';
import {
  createPaystackSignatureTestApp,
  PaystackSignatureTestApp,
} from './support/paystack-signature-test-app';

describe('paystack webhook unknown provider ref', () => {
  let harness: PaystackSignatureTestApp;

  beforeEach(async () => {
    harness = await createPaystackSignatureTestApp();
    harness.verifyPaymentUseCase.execute.mockRejectedValue(
      new NotFoundError('Payment not found.'),
    );
    harness.redisService.setIfNotExists.mockResolvedValue(true);
    harness.redisService.delete.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await harness.close();
  });

  it('returns not found for a validly signed but unknown provider reference', async () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'unknown-ref-404',
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
      .expect(404);

    expect(harness.verifyPaymentUseCase.execute).toHaveBeenCalledTimes(1);
  });
});