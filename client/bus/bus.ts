import type {
  BusMessage,
  BusMessageType,
  MessageOfType,
  PickerValue,
} from "./bus.types.ts";

type Handler<T extends BusMessageType> = (message: MessageOfType<T>) => void;
type RequestHandler<T extends BusMessageType> = (message: MessageOfType<T>) => Promise<unknown>;

class Bus {
  // pub/sub: много подписчиков на один тип
  private listeners = new Map<string, Set<Handler<BusMessageType>>>();

  // rpc: один обработчик на тип (data.load, data.save)
  private handlers = new Map<string, RequestHandler<BusMessageType>>();

  // ожидающие ответа picker.select / picker.cancel
  private pending = new Map<string, {
    resolve: (value: PickerValue) => void;
    reject: (reason?: unknown) => void;
  }>();

  // --- pub/sub ---

  on<T extends BusMessageType>(
    type: T,
    handler: Handler<T>,
  ): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler as Handler<BusMessageType>);
    return () => this.listeners.get(type)?.delete(handler as Handler<BusMessageType>);
  }

  emit(message: BusMessage): void {
    // резолвим pending пиккеры
    if (message.type === "picker.select") {
      this.pending.get(message.callbackId)?.resolve(message.value);
      this.pending.delete(message.callbackId);
    }
    if (message.type === "picker.cancel") {
      this.pending.get(message.callbackId)?.resolve(null);
      this.pending.delete(message.callbackId);
    }

    const handlers = this.listeners.get(message.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(message as MessageOfType<BusMessageType>);
      }
    }
  }

  // --- rpc (data.load / data.save) ---

  handle<T extends BusMessageType>(
    type: T,
    handler: RequestHandler<T>,
  ): void {
    this.handlers.set(type, handler as RequestHandler<BusMessageType>);
  }

  async request<T extends BusMessageType>(
    type: T,
    payload: Omit<MessageOfType<T>, "type">,
  ): Promise<unknown> {
    const handler = this.handlers.get(type);
    if (!handler) throw new Error(`[bus] нет обработчика для ${type}`);
    return await handler({ type, ...payload } as MessageOfType<T>);
  }

  // --- picker ---

  async pick(route: string): Promise<PickerValue> {
    const callbackId = crypto.randomUUID();
    const promise = new Promise<PickerValue>((resolve, reject) => {
      this.pending.set(callbackId, { resolve, reject });
    });
    this.emit({ type: "picker.open", route, callbackId });
    return promise;
  }
}

export const bus = new Bus();
