export class DomainConflictError extends Error {}

export class NotFoundError extends Error {}

export class InvalidStateTransitionError extends Error {}

export class IdempotencyConflictError extends Error {}

export class PaymentAlreadyProcessedError extends Error {}

export class InventoryUnavailableError extends Error {}

export class ReplayDetectedError extends Error {}

export class LaunchControlDisabledError extends Error {}

export class LaunchControlViolationError extends Error {}