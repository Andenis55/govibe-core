import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { EventsModule } from '../events/events.module';
import { InvalidateTicketUseCase } from './application/use-cases/invalidate-ticket.use-case';
import { IssueTicketsUseCase } from './application/use-cases/issue-tickets.use-case';
import { TicketIssuanceService } from './application/ticket-issuance.service';
import { TicketTokenService } from './application/ticket-token.service';
import { TicketsService } from './application/tickets.service';
import { TICKET_REFERENCE_GENERATOR, TICKET_REPOSITORY } from './tickets.tokens';
import { PrismaTicketRepository } from './infrastructure/repositories/prisma-ticket.repository';
import { TicketsController } from './controllers/tickets.controller';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { OutboxModule } from '../../shared/outbox/outbox.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { TicketReferenceGeneratorService } from '../../shared/tickets/ticket-reference-generator.service';
import { TicketsSharedModule } from '../../shared/tickets/tickets-shared.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';

const ticketUseCases = [
  IssueTicketsUseCase,
  InvalidateTicketUseCase,
  TicketsService,
  TicketIssuanceService,
  TicketTokenService,
];

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    LoggingModule,
    TelemetryModule,
    OutboxModule,
    AuditModule,
    OrdersModule,
    InventoryModule,
    TicketsSharedModule,
    PaymentsModule,
    EventsModule,
  ],
  controllers: [TicketsController],
  providers: [
    ...ticketUseCases,
    {
      provide: TICKET_REPOSITORY,
      useClass: PrismaTicketRepository,
    },
    {
      provide: TICKET_REFERENCE_GENERATOR,
      useExisting: TicketReferenceGeneratorService,
    },
  ],
  exports: [
    ...ticketUseCases,
    TICKET_REPOSITORY,
    TICKET_REFERENCE_GENERATOR,
    TicketsService,
    TicketIssuanceService,
    TicketTokenService,
  ],
})
export class TicketsModule {}