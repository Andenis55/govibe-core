export abstract class SmsProvider {
  abstract send(message: Record<string, unknown>): Promise<void>;
}
