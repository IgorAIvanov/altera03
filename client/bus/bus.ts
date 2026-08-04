import type {
  BusMessage,
  BusMessageType,
  ChoiceButton,
  DialogIcon,
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

  // очікують confirm.result / choice.result
  private pendingConfirms = new Map<string, (value: boolean) => void>();
  private pendingChoices = new Map<string, (value: string | null) => void>();

  /**
   * Чи відкрите модальне вікно шини (пікер, підтвердження, вибір).
   *
   * Потрібне гарячим клавішам оболонки: свій Esc діалоги слухають на власному
   * оверлеї, тобто лише коли фокус усередині них. Без цієї перевірки Esc із
   * фокусом деінде закрив би вкладку ПІД відкритим вікном.
   *
   * Екранні діалоги (наприклад «перемістити до групи») сюди не входять — вони
   * не через шину; їхній обов'язок — позначити подію обробленою.
   */
  get modalOpen(): boolean {
    return this.pending.size > 0 || this.pendingConfirms.size > 0 || this.pendingChoices.size > 0;
  }

  // --- pub/sub ---

  on<T extends BusMessageType>(
    type: T,
    handler: Handler<T>,
  ): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler as unknown as Handler<BusMessageType>);
    return () => this.listeners.get(type)?.delete(handler as unknown as Handler<BusMessageType>);
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
    if (message.type === "confirm.result") {
      this.pendingConfirms.get(message.callbackId)?.(message.value);
      this.pendingConfirms.delete(message.callbackId);
    }
    if (message.type === "choice.result") {
      this.pendingChoices.get(message.callbackId)?.(message.value);
      this.pendingChoices.delete(message.callbackId);
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
    this.handlers.set(type, handler as unknown as RequestHandler<BusMessageType>);
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

  async pick(route: string, params?: Record<string, unknown>): Promise<PickerValue> {
    const callbackId = crypto.randomUUID();
    const promise = new Promise<PickerValue>((resolve, reject) => {
      this.pending.set(callbackId, { resolve, reject });
    });
    this.emit({ type: "picker.open", route, callbackId, params });
    return promise;
  }

  // --- confirm ---

  /**
   * Модальне підтвердження в стилі застосунку замість нативного confirm()
   * (той блокує вкладку й показує адресу сайту). Показує confirm-host в
   * оболонці; true — підтверджено. `okKey` — підпис кнопки підтвердження
   * (напр. common.delete для видалень), без нього — common.yes.
   */
  async confirm(text: string, okKey?: string, icon?: DialogIcon): Promise<boolean> {
    const callbackId = crypto.randomUUID();
    const promise = new Promise<boolean>((resolve) => {
      this.pendingConfirms.set(callbackId, resolve);
    });
    this.emit({ type: "confirm.open", text, callbackId, okKey, icon });
    return promise;
  }

  /**
   * Повідомлення окремим вікном — для того, що не прив'язане до жодного поля
   * й не має губитися («користувача деактивовано, а не видалено»). Банер у
   * формі для такого не годиться: екран після дії міг і закритися.
   *
   * Окремого хоста не заводимо — це `choose()` з єдиною кнопкою.
   */
  async alert(text: string, icon: DialogIcon = "info"): Promise<void> {
    await this.choose(text, [{ key: "ok", labelKey: "common.ok", primary: true }], icon);
  }

  /**
   * Діалог вибору з довільними кнопками («Зберегти / Не зберігати /
   * Скасувати»). Повертає key натиснутої кнопки; null — відмова (Esc,
   * хрестик, клік повз вікно). Enter натискає кнопку з primary: true.
   */
  async choose(text: string, buttons: ChoiceButton[], icon?: DialogIcon): Promise<string | null> {
    const callbackId = crypto.randomUUID();
    const promise = new Promise<string | null>((resolve) => {
      this.pendingChoices.set(callbackId, resolve);
    });
    this.emit({ type: "choice.open", text, callbackId, buttons, icon });
    return promise;
  }
}

export const bus: Bus = new Bus();
