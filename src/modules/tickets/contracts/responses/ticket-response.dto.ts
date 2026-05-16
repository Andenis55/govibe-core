import { TicketStatus } from '@prisma/client';

export class TicketResponseDto {
  id!: string;
  ticketNumber!: string;
  ownerUserId!: string;
  eventId!: string;
  organizerId!: string;
  status!: TicketStatus;
  issuedAt!: Date;
  usedAt!: Date | null;
  voidedAt!: Date | null;
  expiresAt!: Date | null;
}