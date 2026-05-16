import { Inject, Injectable } from '@nestjs/common';
import {
  AdmissionRejectionReason,
  AdmissionScanStatus,
  EventStatus,
  Prisma,
  TicketStatus,
} from '@prisma/client';
import { TICKET_REPOSITORY } from '../../tickets/tickets.tokens';
import {
  AdmissionScanTicketRecord,
  TicketRepository,
} from '../../tickets/domain/repositories/ticket.repository.interface';
import { TicketTokenService } from '../../tickets/application/ticket-token.service';
import { TransactionRunnerService } from '../../../shared/prisma/transaction-runner.service';
import { AdmissionScanResponseDto } from '../contracts/responses/admission-scan-response.dto';
import { AdmissionAuditService } from './admission-audit.service';

export type ScanTicketInput = {
  ticketId: string;
  token: string;
  scannedByUserId: string;
  eventId?: string | null;
  deviceId?: string | null;
  gateLabel?: string | null;
};

@Injectable()
export class AdmissionsService {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    private readonly admissionAuditService: AdmissionAuditService,
    private readonly ticketTokenService: TicketTokenService,
    @Inject(TICKET_REPOSITORY)
    private readonly ticketRepository: TicketRepository,
  ) {}

  async scanTicket(input: ScanTicketInput): Promise<AdmissionScanResponseDto> {
    const scannedAt = new Date();
    const tokenHash = this.ticketTokenService.hashToken(input.token);
    const ticket = await this.ticketRepository.findForAdmissionScan(input.ticketId);

    if (!ticket) {
      return this.recordRejectedDecision(
        {
          status: AdmissionScanStatus.REJECTED,
          rejectionReason: AdmissionRejectionReason.TICKET_NOT_FOUND,
          tokenHash,
          scannedByUserId: input.scannedByUserId,
          deviceId: input.deviceId ?? null,
          gateLabel: input.gateLabel ?? null,
          scannedAt,
          metadata: input.eventId ? { providedEventId: input.eventId } : null,
        },
        scannedAt,
      );
    }

    if (!ticket.admissionTokenHash || ticket.admissionTokenHash !== tokenHash) {
      return this.recordRejectedDecision(
        this.buildTicketAuditInput(
          ticket,
          input,
          AdmissionRejectionReason.INVALID_TOKEN,
          tokenHash,
          scannedAt,
        ),
        scannedAt,
      );
    }

    if (ticket.organizerId && ticket.organizerId !== ticket.event.organizerId) {
      return this.recordRejectedDecision(
        this.buildTicketAuditInput(
          ticket,
          input,
          AdmissionRejectionReason.ORGANIZER_MISMATCH,
          tokenHash,
          scannedAt,
        ),
        scannedAt,
      );
    }

    if (ticket.event.organizer.ownerUserId !== input.scannedByUserId) {
      return this.recordRejectedDecision(
        this.buildTicketAuditInput(
          ticket,
          input,
          AdmissionRejectionReason.STAFF_NOT_AUTHORIZED,
          tokenHash,
          scannedAt,
        ),
        scannedAt,
      );
    }

    if (input.eventId && input.eventId !== ticket.eventId) {
      return this.recordRejectedDecision(
        this.buildTicketAuditInput(
          ticket,
          input,
          AdmissionRejectionReason.EVENT_MISMATCH,
          tokenHash,
          scannedAt,
        ),
        scannedAt,
      );
    }

    const preflightRejection = this.classifyTicketState(ticket, scannedAt);

    if (preflightRejection) {
      return this.recordRejectedDecision(
        this.buildTicketAuditInput(
          ticket,
          input,
          preflightRejection,
          tokenHash,
          scannedAt,
        ),
        scannedAt,
      );
    }

    return this.transactionRunner.runInTransaction(
      async (tx) => {
        const updatedCount = await this.ticketRepository.markUsedIfIssuable(
          {
            ticketId: ticket.id,
            admissionTokenHash: tokenHash,
            usedAt: scannedAt,
          },
          tx,
        );

        if (updatedCount === 1) {
          await this.admissionAuditService.record(
            {
              ticketId: ticket.id,
              eventId: ticket.eventId,
              organizerId: ticket.organizerId ?? ticket.event.organizerId,
              scannedByUserId: input.scannedByUserId,
              status: AdmissionScanStatus.ACCEPTED,
              tokenHash,
              deviceId: input.deviceId ?? null,
              gateLabel: input.gateLabel ?? null,
              metadata: input.eventId ? { providedEventId: input.eventId } : null,
              scannedAt,
            },
            { tx },
          );

          return {
            accepted: true,
            status: AdmissionScanStatus.ACCEPTED,
            rejectionReason: null,
            ticketId: ticket.id,
            scannedAt,
          } satisfies AdmissionScanResponseDto;
        }

        const reloaded = await this.ticketRepository.findForAdmissionScan(ticket.id);
        const rejectionReason = reloaded
          ? this.classifyTicketState(reloaded, scannedAt) ?? AdmissionRejectionReason.TOKEN_REPLAY_DETECTED
          : AdmissionRejectionReason.TICKET_NOT_FOUND;

        await this.admissionAuditService.record(
          reloaded
            ? this.buildTicketAuditInput(
                reloaded,
                input,
                rejectionReason,
                tokenHash,
                scannedAt,
              )
            : {
                status: AdmissionScanStatus.REJECTED,
                rejectionReason,
                tokenHash,
                scannedByUserId: input.scannedByUserId,
                deviceId: input.deviceId ?? null,
                gateLabel: input.gateLabel ?? null,
                metadata: input.eventId ? { providedEventId: input.eventId } : null,
                scannedAt,
              },
          { tx },
        );

        return {
          accepted: false,
          status: AdmissionScanStatus.REJECTED,
          rejectionReason,
          ticketId: null,
          scannedAt,
        } satisfies AdmissionScanResponseDto;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    );
  }

  private classifyTicketState(
    ticket: AdmissionScanTicketRecord,
    scannedAt: Date,
  ): AdmissionRejectionReason | null {
    if (ticket.status === TicketStatus.USED) {
      return AdmissionRejectionReason.TICKET_ALREADY_USED;
    }

    if (
      ticket.status === TicketStatus.VOIDED ||
      ticket.status === TicketStatus.INVALIDATED ||
      ticket.status === TicketStatus.REFUNDED ||
      ticket.status === TicketStatus.BLOCKED
    ) {
      return AdmissionRejectionReason.TICKET_VOIDED;
    }

    if (ticket.status === TicketStatus.EXPIRED) {
      return AdmissionRejectionReason.TICKET_EXPIRED;
    }

    if (ticket.status !== TicketStatus.ISSUED) {
      return AdmissionRejectionReason.TICKET_NOT_ISSUED;
    }

    if (ticket.event.status !== EventStatus.PUBLISHED) {
      return AdmissionRejectionReason.EVENT_NOT_ACTIVE;
    }

    if (ticket.expiresAt && scannedAt > ticket.expiresAt) {
      return AdmissionRejectionReason.TICKET_EXPIRED;
    }

    if (scannedAt > ticket.event.endsAt) {
      return AdmissionRejectionReason.EVENT_NOT_ACTIVE;
    }

    return null;
  }

  private buildTicketAuditInput(
    ticket: AdmissionScanTicketRecord,
    input: ScanTicketInput,
    rejectionReason: AdmissionRejectionReason,
    tokenHash: string,
    scannedAt: Date,
  ) {
    return {
      ticketId: ticket.id,
      eventId: ticket.eventId,
      organizerId: ticket.organizerId ?? ticket.event.organizerId,
      scannedByUserId: input.scannedByUserId,
      status: AdmissionScanStatus.REJECTED,
      rejectionReason,
      tokenHash,
      deviceId: input.deviceId ?? null,
      gateLabel: input.gateLabel ?? null,
      metadata: input.eventId ? { providedEventId: input.eventId } : null,
      scannedAt,
    };
  }

  private async recordRejectedDecision(
    input: {
      ticketId?: string | null;
      eventId?: string | null;
      organizerId?: string | null;
      scannedByUserId?: string | null;
      status: AdmissionScanStatus;
      rejectionReason: AdmissionRejectionReason;
      tokenHash?: string | null;
      deviceId?: string | null;
      gateLabel?: string | null;
      metadata?: Prisma.InputJsonValue | null;
      scannedAt: Date;
    },
    scannedAt: Date,
  ): Promise<AdmissionScanResponseDto> {
    await this.admissionAuditService.record(input);

    return {
      accepted: false,
      status: AdmissionScanStatus.REJECTED,
      rejectionReason: input.rejectionReason,
      ticketId: null,
      scannedAt,
    };
  }
}