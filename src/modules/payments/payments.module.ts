import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { EventsModule } from '../events/events.module';
import { OrdersModule } from '../orders/orders.module';
import { UsersModule } from '../../users/users.module';
import { PaymentsService } from './application/payments.service';
import { PaymentVerificationService } from './application/payment-verification.service';
import { GetPaymentIntentUseCase } from './application/use-cases/get-payment-intent.use-case';
import { HandlePaymentWebhookUseCase } from './application/use-cases/handle-payment-webhook.use-case';
import { InitiatePaymentUseCase } from './application/use-cases/initiate-payment.use-case';
import { RefundPaymentUseCase } from './application/use-cases/refund-payment.use-case';
import { VerifyPaymentUseCase } from './application/use-cases/verify-payment.use-case';
import { MomoAdapter } from './infrastructure/providers/momo.adapter';
import { PaystackAdapter } from './infrastructure/providers/paystack.adapter';
import { PrismaLedgerRepository } from './infrastructure/repositories/prisma-ledger.repository';
import { PrismaPaymentRepository } from './infrastructure/repositories/prisma-payment.repository';
import { PrismaPaymentIntentAuditLogRepository } from './infrastructure/repositories/prisma-payment-intent-audit-log.repository';
import { PrismaPaymentIntentRepository } from './infrastructure/repositories/prisma-payment-intent.repository';
import { PrismaProviderWebhookEventRepository } from './infrastructure/repositories/prisma-provider-webhook-event.repository';
import { MOMO_PROVIDER, PAYSTACK_PROVIDER } from './payments.tokens';
import {
  LEDGER_REPOSITORY,
  PAYMENT_INTENT_AUDIT_LOG_REPOSITORY,
  PAYMENT_INTENT_REPOSITORY,
  PAYMENT_REPOSITORY,
  PROVIDER_WEBHOOK_EVENT_REPOSITORY,
} from './payments.tokens';
import { ConfigModule } from '../../shared/config/config.module';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import { LaunchControlModule } from '../../shared/launch-control/launch-control.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { OutboxModule } from '../../shared/outbox/outbox.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { RedisModule } from '../../shared/redis/redis.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';
import { PaymentsController } from './controllers/payments.controller';
import { PaymentWebhooksController } from './controllers/payment-webhooks.controller';
import { ProviderVerificationRegistry } from './verification/provider-verification.registry';
import { PaystackVerificationAdapter } from './verification/paystack-verification.adapter';
import { MtnMomoVerificationAdapter } from './verification/mtn-momo-verification.adapter';
import { WebhookSignatureService } from './webhooks/webhook-signature.service';

const paymentUseCases = [
  PaymentsService,
  PaymentVerificationService,
  InitiatePaymentUseCase,
  GetPaymentIntentUseCase,
  VerifyPaymentUseCase,
  HandlePaymentWebhookUseCase,
  RefundPaymentUseCase,
];

const paymentAdapters = [
  PaystackAdapter,
  MomoAdapter,
  {
    provide: PAYSTACK_PROVIDER,
    useExisting: PaystackAdapter,
  },
  {
    provide: MOMO_PROVIDER,
    useExisting: MomoAdapter,
  },
];

const verificationProviders = [
  PaystackVerificationAdapter,
  MtnMomoVerificationAdapter,
  ProviderVerificationRegistry,
  WebhookSignatureService,
];

@Module({
  imports: [
    AuthModule,
    ConfigModule,
    PrismaModule,
    RedisModule,
    LoggingModule,
    TelemetryModule,
    LaunchControlModule,
    IdempotencyModule,
    OutboxModule,
    OrdersModule,
    EventsModule,
    AuditModule,
    UsersModule,
  ],
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [
    ...paymentUseCases,
    ...paymentAdapters,
    ...verificationProviders,
    {
      provide: PAYMENT_REPOSITORY,
      useClass: PrismaPaymentRepository,
    },
    {
      provide: LEDGER_REPOSITORY,
      useClass: PrismaLedgerRepository,
    },
    {
      provide: PAYMENT_INTENT_REPOSITORY,
      useClass: PrismaPaymentIntentRepository,
    },
    {
      provide: PAYMENT_INTENT_AUDIT_LOG_REPOSITORY,
      useClass: PrismaPaymentIntentAuditLogRepository,
    },
    {
      provide: PROVIDER_WEBHOOK_EVENT_REPOSITORY,
      useClass: PrismaProviderWebhookEventRepository,
    },
  ],
  exports: [
    ...paymentUseCases,
    ...verificationProviders,
    PAYSTACK_PROVIDER,
    MOMO_PROVIDER,
    PAYMENT_REPOSITORY,
    LEDGER_REPOSITORY,
    PAYMENT_INTENT_REPOSITORY,
    PAYMENT_INTENT_AUDIT_LOG_REPOSITORY,
    PROVIDER_WEBHOOK_EVENT_REPOSITORY,
  ],
})
export class PaymentsModule {}