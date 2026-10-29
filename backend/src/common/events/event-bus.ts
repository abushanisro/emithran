// A publish/subscribe bus for short live-progress events (SSE). The publisher and the browser's SSE connection are two
// different HTTP requests, so with more than one backend instance they can land on different servers: the bus carries
// an event from the instance that publishes it to every instance that has a subscriber.
//
// One implementation today (InProcessEventBus, one process); the token lets a shared bus replace it for several instances.
//
// Events are small: send ids and counts, and let the client fetch the rest.

export const EVENT_BUS = Symbol('EVENT_BUS');

export interface BusEvent {
  type: string;
  data: Record<string, unknown>;
}

export type BusHandler = (event: BusEvent) => void;

export interface EventBus {
  publish(channel: string, event: BusEvent): Promise<void>;
  /** Returns the function that unsubscribes. */
  subscribe(channel: string, handler: BusHandler): () => void;
}

/** Local fan-out: channel -> handlers. A throwing handler does not stop the others. */
export class LocalSubscribers {
  private readonly handlers = new Map<string, Set<BusHandler>>();

  subscribe(channel: string, handler: BusHandler): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    return () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.handlers.delete(channel);
    };
  }

  deliver(channel: string, event: BusEvent, onError: (error: unknown) => void): void {
    for (const handler of [...(this.handlers.get(channel) ?? [])]) {
      try {
        handler(event);
      } catch (error) {
        onError(error);
      }
    }
  }

  channelCount(): number {
    return this.handlers.size;
  }
}

export class InProcessEventBus implements EventBus {
  private readonly local = new LocalSubscribers();

  async publish(channel: string, event: BusEvent): Promise<void> {
    this.local.deliver(channel, event, () => undefined);
  }

  subscribe(channel: string, handler: BusHandler): () => void {
    return this.local.subscribe(channel, handler);
  }
}
