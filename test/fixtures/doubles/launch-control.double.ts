import { LaunchControlService } from '../../../src/shared/launch-control/launch-control.service';

export class LaunchControlDouble {
  readonly assertCheckoutAllowed = jest.fn(async () => undefined);

  readonly assertPaymentInitiationAllowed = jest.fn(async () => undefined);

  readonly assertAdmissionValidationAllowed = jest.fn(async () => undefined);

  asService(): LaunchControlService {
    return this as unknown as LaunchControlService;
  }
}