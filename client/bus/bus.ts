import type {
  BusMessage,
  BusMessageType,
  ChoiceButton,
  DialogIcon,
  MessageOfType,
  PickerSelectMessage,
  PickerValue,
} from "./bus.types.ts";

type Handler<T extends BusMessageType> = (message: MessageOfType<T>) => void;
type RequestHandler<T extends BusMessageType> = (message: MessageOfType<T>) => Promise<unknown>;

class Bus {
  // pub/sub: много подписчиков на один тип
  private listeners = new Map<string, Set<Handler<BusMessageType>>>();

  // rpc: один обработчик на тип (data.load, data.save)
  private handlers = new Map<string, RequestHandler<BusMessageType>>();

  // очікують picker.select / picker.cancel.
  // Резолвиться ПОВІДОМЛЕННЯМ, а не готовим значенням: `pick()` бере з нього
  // одне значення, `pickMany()` — масив. Інакше довелося б тримати дві черги
  // на один і той самий діалог.
  private pending = new Map<string, {
    resolve: (value: Pick<PickerSelectMessage, "value" | "values"> | null) => void;
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
      this.pending.get(message.callbackId)?.resolve({ value: message.value, values: message.values });
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
    const picked = await this.#openPicker(route, params, false);
    return picked?.value ?? null;
  }

  /**
   * Підбір ПАЧКОЮ: діалог показує позначки рядків, повертає всі відмічені.
   * `null` — відмова. Типовий випадок — додати кілька позицій номенклатури в
   * табличну частину документа за один захід.
   *
   * Множинність задає викликач, а не пікер: той самий довідник підбирають то
   * одним значенням у поле, то пачкою — і переписувати заради цього екран
   * пікера не треба.
   */
  async pickMany(
    route: string,
    params?: Record<string, unknown>,
  ): Promise<{ id: string; label: string }[] | null> {
    const picked = await this.#openPicker(route, params, true);
    if (!picked) return null;
    // `values` немає лише якщо діалог відповів по-старому — тоді це один рядок.
    return picked.values ?? [picked.value];
  }

  #openPicker(
    route: string,
    params: Record<string, unknown> | undefined,
    multiple: boolean,
  ): Promise<Pick<PickerSelectMessage, "value" | "values"> | null> {
    const callbackId = crypto.randomUUID();
    const promise = new Promise<Pick<PickerSelectMessage, "value" | "values"> | null>(
      (resolve, reject) => {
        this.pending.set(callbackId, { resolve, reject });
      },
    );
    this.emit({ type: "picker.open", route, callbackId, params, multiple });
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
