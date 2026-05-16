export abstract class PushProvider {
  abstract send(message: Record<string, unknown>): Promise<void>;
}
