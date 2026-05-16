import { createHmac } from 'node:crypto';
import { AppConfigService } from '../../../src/shared/config/config.service';
import { PaystackAdapter } from '../../../src/modules/payments/infrastructure/providers/paystack.adapter';
import { WebhookSignatureError } from '../../../src/modules/payments/domain/providers/provider-errors';

describe('PaystackAdapter', () => {
  const secret = 'paystack_secret_key_12345';
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(secret),
  } as unknown as AppConfigService;

  const adapter = new PaystackAdapter(configService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts a valid raw-body signature and parses the webhook payload', async () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        data: {
          reference: 'payment-ref-1',
          status: 'success',
          amount: 5000,
          currency: 'GHS',
        },
      }),
    );
    const signature = createHmac('sha512', secret).update(rawBody).digest('hex');

    const result = await adapter.parseWebhook({
      rawBody,
      parsedBody: JSON.parse(rawBody.toString('utf8')) as unknown,
      headers: {
        'x-paystack-signature': signature,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        providerRef: 'payment-ref-1',
        status: 'SUCCESS',
        currency: 'GHS',
        amountMinor: BigInt(5000),
      }),
    );
  });

  it('rejects a mutated raw body when the signature was calculated from the original payload', async () => {
    const originalBody = Buffer.from(
      JSON.stringify({
        data: {
          reference: 'payment-ref-1',
          status: 'success',
          amount: 5000,
          currency: 'GHS',
        },
      }),
    );
    const mutatedBody = Buffer.from(
      JSON.stringify({
        data: {
          reference: 'payment-ref-1',
          status: 'failed',
          amount: 5000,
          currency: 'GHS',
        },
      }),
    );
    const signature = createHmac('sha512', secret)
      .update(originalBody)
      .digest('hex');

    await expect(
      adapter.parseWebhook({
        rawBody: mutatedBody,
        parsedBody: JSON.parse(mutatedBody.toString('utf8')) as unknown,
        headers: {
          'x-paystack-signature': signature,
        },
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});