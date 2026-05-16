export abstract class EmailProvider {
  abstract send(message: Record<string, unknown>): Promise<void>;
}
