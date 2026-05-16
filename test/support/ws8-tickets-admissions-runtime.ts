import { randomUUID } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { AppRole } from '../../src/common/constants/roles';
import { AppPermission } from '../../src/common/constants/permissions';
import { AuthUser } from '../../src/common/types/auth-user.type';
import { AdmissionsService } from '../../src/modules/admissions/application/admissions.service';
import { AdmissionAuditService } from '../../src/modules/admissions/application/admission-audit.service';
import { QR_TOKEN_VERIFIER } from '../../src/modules/admissions/admissions.tokens';
import { PaymentIntentRepository } from '../../src/modules/payments/domain/repositories/payment-intent.repository.interface';
import { PaystackVerificationAdapter } from '../../src/modules/payments/verification/paystack-verification.adapter';
import { MtnMomoVerificationAdapter } from '../../src/modules/payments/verification/mtn-momo-verification.adapter';
import { PAYMENT_INTENT_REPOSITORY } from '../../src/modules/payments/payments.tokens';
import { TicketIssuanceService } from '../../src/modules/tickets/application/ticket-issuance.service';
import {
  TicketRepository,
} from '../../src/modules/tickets/domain/repositories/ticket.repository.interface';
import { TICKET_REPOSITORY } from '../../src/modules/tickets/tickets.tokens';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RedisService } from '../../src/shared/redis/redis.service';
import { OUTBOX_DISPATCHER } from '../../src/shared/outbox/outbox.tokens';
import {
  ContainerRuntimeUnavailableError,
  createIntegrationRuntime,
  IntegrationRuntime,
} from '../setup/integration-runtime';
import { createTestApp } from '../setup/test-app.factory';

class TestJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthUser;
    }>();

    if (!request.headers.authorization) {
      throw new UnauthorizedException('Unauthorized');
    }

    const userId = request.headers['x-test-user-id'] ?? randomUUID();
    const roleHeader = request.headers['x-test-role'] ?? AppRole.CUSTOMER;
    const role =
      roleHeader === AppRole.ORGANIZER ||
      roleHeader === AppRole.GATE_STAFF ||
      roleHeader === AppRole.ADMIN
        ? roleHeader
        : AppRole.CUSTOMER;

    request.user = {
      id: userId,
      email: `${userId}@example.com`,
      role,
      sessionId: `session-${userId}`,
      permissions: [] as AppPermission[],
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    return true;
  }
}

export type Ws8TicketsAdmissionsRuntime = IntegrationRuntime & {
  app: INestApplication;
  ticketIssuanceService: TicketIssuanceService;
  admissionsService: AdmissionsService;
  admissionAuditService: AdmissionAuditService;
  paymentIntentRepository: PaymentIntentRepository;
  ticketRepository: TicketRepository;
  paystackVerificationAdapter: PaystackVerificationAdapter;
  momoVerificationAdapter: MtnMomoVerificationAdapter;
  dispose: () => Promise<void>;
};

export async function createWs8TicketsAdmissionsRuntime(): Promise<Ws8TicketsAdmissionsRuntime> {
  let integration: IntegrationRuntime;

  try {
    integration = await createIntegrationRuntime();
  } catch (error) {
    if (error instanceof ContainerRuntimeUnavailableError) {
      throw error;
    }

    throw error;
  }

  const builder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(integration.prisma)
    .overrideProvider('REDIS_CLIENT')
    .useValue(integration.redisClient)
    .overrideProvider(RedisService)
    .useValue(integration.redisService)
    .overrideProvider(QR_TOKEN_VERIFIER)
    .useValue({ verify: jest.fn() })
    .overrideProvider(OUTBOX_DISPATCHER)
    .useValue({ dispatch: jest.fn() })
    .overrideGuard(JwtAuthGuard)
    .useValue(new TestJwtAuthGuard());

  const app = await createTestApp(builder);

  return {
    ...integration,
    app,
    ticketIssuanceService: app.get(TicketIssuanceService),
    admissionsService: app.get(AdmissionsService),
    admissionAuditService: app.get(AdmissionAuditService),
    paymentIntentRepository: app.get(PAYMENT_INTENT_REPOSITORY),
    ticketRepository: app.get(TICKET_REPOSITORY),
    paystackVerificationAdapter: app.get(PaystackVerificationAdapter),
    momoVerificationAdapter: app.get(MtnMomoVerificationAdapter),
    dispose: async () => {
      await Promise.allSettled([app.close(), integration.dispose()]);
    },
  };
}

export { ContainerRuntimeUnavailableError };