import { Global, Module } from '@nestjs/common';
import { DefaultTicketReferenceAllocatorService } from './ticket-reference-allocator.service';
import { TicketReferenceGeneratorService } from './ticket-reference-generator.service';

@Global()
@Module({
  providers: [
    TicketReferenceGeneratorService,
    DefaultTicketReferenceAllocatorService,
    {
      provide: 'TICKET_REFERENCE_GENERATOR',
      useExisting: TicketReferenceGeneratorService,
    },
  ],
  exports: [
    'TICKET_REFERENCE_GENERATOR',
    TicketReferenceGeneratorService,
    DefaultTicketReferenceAllocatorService,
  ],
})
export class TicketsSharedModule {}