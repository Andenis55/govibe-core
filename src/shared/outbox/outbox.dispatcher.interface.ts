export type DispatchableOutboxEvent = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export interface OutboxDispatcher {
  dispatch(event: DispatchableOutboxEvent): Promise<void>;
}