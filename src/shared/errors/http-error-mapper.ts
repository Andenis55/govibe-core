import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ProviderAuthError,
  ProviderNetworkError,
  ProviderResponseError,
  ProviderTimeoutError,
  WebhookSignatureError,
} from '../../modules/payments/domain/providers/provider-errors';
import {
  DomainConflictError,
  IdempotencyConflictError,
  InvalidStateTransitionError,
  InventoryUnavailableError,
  LaunchControlDisabledError,
  LaunchControlViolationError,
  NotFoundError,
  PaymentAlreadyProcessedError,
  ReplayDetectedError,
} from './domain-errors';

export function mapErrorToHttp(error: unknown): HttpException {
  if (error instanceof NotFoundError) {
    return new NotFoundException(error.message);
  }

  if (error instanceof InventoryUnavailableError) {
    return new ConflictException(error.message);
  }

  if (error instanceof DomainConflictError) {
    return new ConflictException(error.message);
  }

  if (error instanceof IdempotencyConflictError) {
    return new ConflictException(error.message);
  }

  if (error instanceof PaymentAlreadyProcessedError) {
    return new ConflictException(error.message);
  }

  if (error instanceof ReplayDetectedError) {
    return new ConflictException(error.message);
  }

  if (error instanceof LaunchControlViolationError) {
    return new ForbiddenException(error.message);
  }

  if (error instanceof LaunchControlDisabledError) {
    return new ServiceUnavailableException(error.message);
  }

  if (error instanceof InvalidStateTransitionError) {
    return new BadRequestException(error.message);
  }

  if (error instanceof WebhookSignatureError) {
    return new UnauthorizedException(error.message);
  }

  if (error instanceof ProviderTimeoutError) {
    return new GatewayTimeoutException(error.message);
  }

  if (error instanceof ProviderAuthError || error instanceof ProviderNetworkError) {
    return new ServiceUnavailableException(error.message);
  }

  if (error instanceof ProviderResponseError) {
    if (error.statusCode >= 500 || error.statusCode === 0) {
      return new ServiceUnavailableException(error.message);
    }

    if (error.statusCode >= 400 && error.statusCode < 500) {
      return new BadRequestException(error.message);
    }

    return new ServiceUnavailableException(error.message);
  }

  if (
    error instanceof Error &&
    error.message.startsWith('Nonce replay protection unavailable:')
  ) {
    return new ServiceUnavailableException(error.message);
  }

  return new InternalServerErrorException(
    error instanceof Error ? error.message : 'Unexpected server error',
  );
}