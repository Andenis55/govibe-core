import { Injectable } from '@nestjs/common';
import {
  type SupportedCurrency,
  type SupportedPaymentProvider,
} from '../constants/payment.constants';
import { AppConfigService } from '../config/config.service';
import {
  DomainConflictError,
  LaunchControlDisabledError,
  LaunchControlViolationError,
  NotFoundError,
} from '../errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';

type EventScope = {
  eventId: string;
  organizerId: string;
  venueId: string;
};

@Injectable()
export class LaunchControlService {
  private readonly checkoutEnabled: boolean;

  private readonly paymentsEnabled: boolean;

  private readonly admissionsEnabled: boolean;

  private readonly allowedProviders?: ReadonlySet<SupportedPaymentProvider>;

  private readonly allowedCurrencies?: ReadonlySet<SupportedCurrency>;

  private readonly allowedOrganizerIds?: ReadonlySet<string>;

  private readonly allowedEventIds?: ReadonlySet<string>;

  private readonly allowedGateIds?: ReadonlySet<string>;

  constructor(
    private readonly configService: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.checkoutEnabled = configService.getOptional('PILOT_CHECKOUT_ENABLED') ?? true;
    this.paymentsEnabled = configService.getOptional('PILOT_PAYMENTS_ENABLED') ?? true;
    this.admissionsEnabled =
      configService.getOptional('PILOT_ADMISSIONS_ENABLED') ?? true;
    this.allowedProviders = this.toReadonlySet(
      configService.getOptional('PILOT_ALLOWED_PAYMENT_PROVIDERS'),
    );
    this.allowedCurrencies = this.toReadonlySet(
      configService.getOptional('PILOT_ALLOWED_CURRENCIES'),
    );
    this.allowedOrganizerIds = this.toReadonlySet(
      configService.getOptional('PILOT_ALLOWED_ORGANIZER_IDS'),
    );
    this.allowedEventIds = this.toReadonlySet(
      configService.getOptional('PILOT_ALLOWED_EVENT_IDS'),
    );
    this.allowedGateIds = this.toReadonlySet(
      configService.getOptional('PILOT_ALLOWED_GATE_IDS'),
    );
  }

  async assertCheckoutAllowed(input: {
    eventId: string;
    currency: string;
  }): Promise<void> {
    if (!this.checkoutEnabled) {
      throw new LaunchControlDisabledError(
        'Checkout is disabled by pilot launch control.',
      );
    }

    const scope = await this.loadEventScope(input.eventId);

    this.assertEventScopeAllowed(scope);
    this.assertCurrencyAllowed(input.currency);
  }

  async assertPaymentInitiationAllowed(input: {
    provider: SupportedPaymentProvider;
    eventId: string;
    currency: string;
  }): Promise<void> {
    if (!this.paymentsEnabled) {
      throw new LaunchControlDisabledError(
        'Payment initiation is disabled by pilot launch control.',
      );
    }

    const scope = await this.loadEventScope(input.eventId);

    this.assertEventScopeAllowed(scope);
    this.assertProviderAllowed(input.provider);
    this.assertCurrencyAllowed(input.currency);
  }

  async assertAdmissionValidationAllowed(input: {
    eventId: string;
    gateId: string;
  }): Promise<void> {
    if (!this.admissionsEnabled) {
      throw new LaunchControlDisabledError(
        'Admission validation is disabled by pilot launch control.',
      );
    }

    const [scope, gate] = await Promise.all([
      this.loadEventScope(input.eventId),
      this.loadGate(input.gateId),
    ]);

    this.assertEventScopeAllowed(scope);

    if (gate.venueId !== scope.venueId) {
      throw new DomainConflictError(
        'Gate does not belong to the ticket event venue.',
      );
    }

    if (this.allowedGateIds && !this.allowedGateIds.has(input.gateId)) {
      throw new LaunchControlViolationError(
        `Gate ${input.gateId} is not enabled for the pilot.`,
      );
    }
  }

  private async loadEventScope(eventId: string): Promise<EventScope> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        organizerId: true,
        venueId: true,
      },
    });

    if (!event) {
      throw new NotFoundError('Event not found.');
    }

    return {
      eventId: event.id,
      organizerId: event.organizerId,
      venueId: event.venueId,
    };
  }

  private async loadGate(gateId: string): Promise<{ id: string; venueId: string }> {
    const gate = await this.prisma.gate.findUnique({
      where: { id: gateId },
      select: {
        id: true,
        venueId: true,
      },
    });

    if (!gate) {
      throw new NotFoundError('Gate not found.');
    }

    return gate;
  }

  private assertEventScopeAllowed(scope: EventScope): void {
    if (this.allowedEventIds && !this.allowedEventIds.has(scope.eventId)) {
      throw new LaunchControlViolationError(
        `Event ${scope.eventId} is not enabled for the pilot.`,
      );
    }

    if (
      this.allowedOrganizerIds &&
      !this.allowedOrganizerIds.has(scope.organizerId)
    ) {
      throw new LaunchControlViolationError(
        `Organizer ${scope.organizerId} is not enabled for the pilot.`,
      );
    }
  }

  private assertProviderAllowed(provider: SupportedPaymentProvider): void {
    if (this.allowedProviders && !this.allowedProviders.has(provider)) {
      throw new LaunchControlViolationError(
        `Payment provider ${provider} is not enabled for the pilot.`,
      );
    }
  }

  private assertCurrencyAllowed(currency: string): void {
    if (this.allowedCurrencies && !this.allowedCurrencies.has(currency as SupportedCurrency)) {
      throw new LaunchControlViolationError(
        `Currency ${currency} is not enabled for the pilot.`,
      );
    }
  }

  private toReadonlySet<T extends string>(
    values: readonly T[] | undefined,
  ): ReadonlySet<T> | undefined {
    if (!values || values.length === 0) {
      return undefined;
    }

    return new Set(values);
  }
}