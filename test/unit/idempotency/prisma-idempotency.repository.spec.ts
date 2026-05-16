import { createHash } from 'node:crypto';
import { PrismaIdempotencyRepository } from '../../../src/modules/idempotency/infrastructure/repositories/prisma-idempotency.repository';

describe('PrismaIdempotencyRepository', () => {
  const repository = new PrismaIdempotencyRepository();

  it('scopes lookups by actor, use case, and hashed idempotency key', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const tx = {
      idempotencyKey: {
        findUnique,
      },
    };

    await repository.findByKey(
      {
        actorUserId: 'user-1',
        useCase: 'checkout.create_order',
        idempotencyKey: 'shared-key',
      },
      tx as never,
    );

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        actorUserId_useCase_idempotencyKeyHash: {
          actorUserId: 'user-1',
          useCase: 'checkout.create_order',
          idempotencyKeyHash: createHash('sha256')
            .update('shared-key')
            .digest('hex'),
        },
      },
      select: {
        actorUserId: true,
        useCase: true,
        idempotencyKeyHash: true,
        requestHash: true,
        responseCode: true,
        responseBody: true,
      },
    });
  });

  it('stores and completes records with the same scoped hash key', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue(undefined);
    const tx = {
      idempotencyKey: {
        create,
        update,
      },
    };

    await repository.tryCreatePending(
      {
        actorUserId: 'user-1',
        useCase: 'payments.initiate',
        idempotencyKey: 'shared-key',
        requestHash: 'request-hash',
      },
      tx as never,
    );

    await repository.complete(
      {
        actorUserId: 'user-1',
        useCase: 'payments.initiate',
        idempotencyKey: 'shared-key',
        responseCode: 201,
        responseBody: { paymentId: 'payment-1' },
      },
      tx as never,
    );

    const idempotencyKeyHash = createHash('sha256')
      .update('shared-key')
      .digest('hex');

    expect(create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-1',
        useCase: 'payments.initiate',
        idempotencyKeyHash,
        requestHash: 'request-hash',
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: {
        actorUserId_useCase_idempotencyKeyHash: {
          actorUserId: 'user-1',
          useCase: 'payments.initiate',
          idempotencyKeyHash,
        },
      },
      data: {
        responseCode: 201,
        responseBody: { paymentId: 'payment-1' },
      },
    });
  });
});