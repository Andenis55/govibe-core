import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TICKET_REPOSITORY } from '../tickets.tokens';
import {
  TicketRepository,
  TicketViewRecord,
} from '../domain/repositories/ticket.repository.interface';
import { TicketResponseDto } from '../contracts/responses/ticket-response.dto';

@Injectable()
export class TicketsService {
  constructor(
    @Inject(TICKET_REPOSITORY)
    private readonly ticketRepository: TicketRepository,
  ) {}

  async listMine(ownerUserId: string): Promise<TicketResponseDto[]> {
    const tickets = await this.ticketRepository.findOwnedByUser(ownerUserId);
    return tickets.map((ticket) => this.toResponse(ticket));
  }

  async getOwned(ticketId: string, ownerUserId: string): Promise<TicketResponseDto> {
    const ticket = await this.ticketRepository.findOwnedById({
      ticketId,
      ownerUserId,
    });

    if (!ticket) {
      throw new NotFoundException('ticket not found');
    }

    return this.toResponse(ticket);
  }

  private toResponse(ticket: TicketViewRecord): TicketResponseDto {
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