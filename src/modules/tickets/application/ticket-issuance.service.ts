import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PaymentIntentStatus, Prisma, TicketStatus } from '@prisma/client';
import { EVENT_REPOSITORY } from '../../events/events.tokens';
import { EventRepository } from '../../events/domain/repositories/event.repository.interface';
import { PAYMENT_INTENT_REPOSITORY } from '../../payments/payments.tokens';
import {
  PaymentIntentRepository,
  TicketIssuancePaymentIntentRecord,
} from '../../payments/domain/repositories/payment-intent.repository.interface';
import { InvalidStateTransitionError, NotFoundError } from '../../../shared/errors/domain-errors';
import { TransactionRunnerService } from '../../../shared/prisma/transaction-runner.service';
import { TICKET_REPOSITORY } from '../tickets.tokens';
import {
  TicketRepository,
  TicketViewRecord,
} from '../domain/repositories/ticket.repository.interface';
import { IssuedTicketResponseDto } from '../contracts/responses/issued-ticket-response.dto';
import { TicketResponseDto } from '../contracts/responses/ticket-response.dto';
import { TicketTokenService } from './ticket-token.service';

type IssuanceOutcome =
  | { kind: 'created'; ticket: TicketViewRecord; token: string }
  | { kind: 'existing'; ticket: TicketViewRecord }
  | { kind: 'rejected'; message: string }
  | { kind: 'failed'; message: string };

@Injectable()
export class TicketIssuanceService {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    private readonly ticketTokenService: TicketTokenService,
    @Inject(TICKET_REPOSITORY)
    private readonly ticketRepository: TicketRepository,
    @Inject(PAYMENT_INTENT_REPOSITORY)
    private readonly paymentIntentRepository: PaymentIntentRepository,
    @Inject(EVENT_REPOSITORY)
    private readonly eventRepository: EventRepository,
  ) {}

  async issueTicketFromVerifiedPayment(
    paymentIntentId: string,
  ): Promise<IssuedTicketResponseDto> {
    const outcome = await this.transactionRunner.runInTransaction<IssuanceOutcome>(
      async (tx) => {
        const paymentIntent = await this.paymentIntentRepository.findByIdForTicketIssuance(
          paymentIntentId,
          { tx },
        );

        if (!paymentIntent) {
          throw new NotFoundError('payment intent not found');
        }

        if (paymentIntent.status !== PaymentIntentStatus.VERIFIED) {
          await this.ticketRepository.appendIssuanceAudit(
            {
              paymentIntentId: paymentIntent.id,
              buyerUserId: paymentIntent.buyerUserId,
              eventId: paymentIntent.eventId,
              organizerId: paymentIntent.organizerId,
              auditEvent: 'ticket_issuance_rejected_payment_not_verified',
              reason: paymentIntent.status,
            },
            tx,
          );

          return {
            kind: 'rejected',
            message: 'Only verified payment intents can issue tickets.',
          };
        }

        if (!this.hasIssuanceSnapshot(paymentIntent)) {
          await this.ticketRepository.appendIssuanceAudit(
            {
              paymentIntentId: paymentIntent.id,
              buyerUserId: paymentIntent.buyerUserId,
              eventId: paymentIntent.eventId,
              organizerId: paymentIntent.organizerId,
              auditEvent: 'ticket_issuance_failed',
              reason: 'missing_issuance_snapshot',
            },
            tx,
          );

          return {
            kind: 'failed',
            message: 'Verified payment intent is missing ticket issuance context.',
          };
        }

        const event = await this.eventRepository.findByIdForPaymentInitiation(
          paymentIntent.eventId,
          { tx },
        );

        if (!event || event.organizerId !== paymentIntent.organizerId) {
          await this.ticketRepository.appendIssuanceAudit(
            {
              paymentIntentId: paymentIntent.id,
              buyerUserId: paymentIntent.buyerUserId,
              eventId: paymentIntent.eventId,
              organizerId: paymentIntent.organizerId,
              auditEvent: 'ticket_issuance_failed',
              reason: 'missing_event_snapshot',
            },
            tx,
          );

          return {
            kind: 'failed',
            message: 'Verified payment intent is missing ticket issuance context.',
          };
        }

        await this.ticketRepository.appendIssuanceAudit(
          {
            paymentIntentId: paymentIntent.id,
            buyerUserId: paymentIntent.buyerUserId,
            eventId: paymentIntent.eventId,
            organizerId: paymentIntent.organizerId,
            auditEvent: 'ticket_issuance_requested',
          },
          tx,
        );

        const existing = await this.ticketRepository.findByPaymentIntentOwnerAndEvent(
          {
            paymentIntentId: paymentIntent.id,
            ownerUserId: paymentIntent.buyerUserId,
            eventId: paymentIntent.eventId,
          },
          tx,
        );

        if (existing) {
          await this.ticketRepository.appendIssuanceAudit(
            {
              paymentIntentId: paymentIntent.id,
              ticketId: existing.id,
              buyerUserId: paymentIntent.buyerUserId,
              eventId: paymentIntent.eventId,
              organizerId: paymentIntent.organizerId,
              auditEvent: 'ticket_issuance_idempotent_replay',
            },
            tx,
          );

          return {
            kind: 'existing',
            ticket: existing,
          };
        }

        const issuedAt = new Date();
        const ticketNumber = this.ticketTokenService.generateTicketNumber();
        const admissionToken = this.ticketTokenService.generateAdmissionToken();
        const ticketSerial = ticketNumber;
        const publicReference = ticketNumber;

        try {
          const ticket = await this.ticketRepository.createIssuedTicket(
            {
              id: randomUUID(),
              ticketNumber,
              ownerUserId: paymentIntent.buyerUserId,
              eventId: paymentIntent.eventId,
              organizerId: paymentIntent.organizerId,
              paymentIntentId: paymentIntent.id,
              admissionTokenHash: admissionToken.hash,
              admissionTokenVersion: admissionToken.version,
              issuedAt,
              expiresAt: event.endsAt,
              ticketSerial,
              publicReference,
            },
            tx,
          );

          await this.ticketRepository.appendIssuanceAudit(
            {
              paymentIntentId: paymentIntent.id,
              ticketId: ticket.id,
              buyerUserId: paymentIntent.buyerUserId,
              eventId: paymentIntent.eventId,
              organizerId: paymentIntent.organizerId,
              auditEvent: 'ticket_issued',
            },
            tx,
          );

          return {
            kind: 'created',
            ticket,
            token: admissionToken.token,
          };
        } catch (error) {
          if (this.isPrismaUniqueViolation(error)) {
            const recovered = await this.ticketRepository.findByPaymentIntentOwnerAndEvent(
              {
                paymentIntentId: paymentIntent.id,
                ownerUserId: paymentIntent.buyerUserId,
                eventId: paymentIntent.eventId,
              },
              tx,
            );

            if (recovered) {
              await this.ticketRepository.appendIssuanceAudit(
                {
                  paymentIntentId: paymentIntent.id,
                  ticketId: recovered.id,
                  buyerUserId: paymentIntent.buyerUserId,
                  eventId: paymentIntent.eventId,
                  organizerId: paymentIntent.organizerId,
                  auditEvent: 'ticket_issuance_idempotent_replay',
                  reason: 'p2002_recovered_existing_ticket',
                },
                tx,
              );

              return {
                kind: 'existing',
                ticket: recovered,
              };
            }
          }

          await this.ticketRepository.appendIssuanceAudit(
            {
              paymentIntentId: paymentIntent.id,
              buyerUserId: paymentIntent.buyerUserId,
              eventId: paymentIntent.eventId,
              organizerId: paymentIntent.organizerId,
              auditEvent: 'ticket_issuance_failed',
              reason: error instanceof Error ? error.message : 'unknown_error',
            },
            tx,
          );

          throw error;
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
      },
    );

    if (outcome.kind === 'rejected' || outcome.kind === 'failed') {
      throw new InvalidStateTransitionError(outcome.message);
    }

    return {
      ticket: this.toTicketResponse(outcome.ticket),
      qrPayload:
        outcome.kind === 'created'
          ? {
              ticketId: outcome.ticket.id,
              token: outcome.token,
            }
          : null,
    };
  }

  private hasIssuanceSnapshot(
    paymentIntent: TicketIssuancePaymentIntentRecord,
  ): boolean {
    return Boolean(
      paymentIntent.buyer &&
        paymentIntent.organizer &&
        paymentIntent.event &&
        paymentIntent.event.organizer,
    );
  }

  private isPrismaUniqueViolation(error: unknown): error is { code: string } {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002',
    );
  }

  private toTicketResponse(ticket: TicketViewRecord): TicketResponseDto {
    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber ?? ticket.id,
      ownerUserId: ticket.ownerUserId,
      eventId: ticket.eventId,
      organizerId: ticket.organizerId ?? ticket.event.organizerId,
      status: ticket.status,
      issuedAt: ticket.issuedAt,
      usedAt: ticket.usedAt,
      voidedAt: ticket.voidedAt,
      expiresAt: ticket.expiresAt,
    };
  }
}