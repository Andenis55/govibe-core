import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TicketReferenceGeneratorService } from './ticket-reference-generator.service';

export interface TicketReferenceAllocatorService {
  allocateBatch<T>(
    count: number,
    writer: (
      refs: Array<{ ticketSerial: string; publicReference: string }>,
    ) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class DefaultTicketReferenceAllocatorService
  implements TicketReferenceAllocatorService
{
  private static readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly generator: TicketReferenceGeneratorService,
  ) {}

  async allocateBatch<T>(
    count: number,
    writer: (
      refs: Array<{ ticketSerial: string; publicReference: string }>,
    ) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= DefaultTicketReferenceAllocatorService.MAX_ATTEMPTS;
      attempt += 1
    ) {
      const refs = Array.from({ length: count }).map(() => ({
        ticketSerial: this.generator.generateSerial(),
        publicReference: this.generator.generatePublicReference(),
      }));

      try {
        return await writer(refs);
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }

        lastError = error;
      }
    }

    throw new Error(
      `Ticket reference allocation failed after ${DefaultTicketReferenceAllocatorService.MAX_ATTEMPTS} attempts: ${
        (lastError as Error | undefined)?.message ?? 'unknown error'
      }`,
    );
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'P2002')
    );
  }
}