import { state } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { deep } from "signal-utils/deep";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { GlobalStyledLitElement } from "./gsle.ts";

/** Одне повідомлення з конверта відповіді сервера. */
export interface Message {
  type?: "info" | "warn" | "error";
  text?: string;
}

/** Стандартний конверт відповіді: `{ ok, data, messages }`. */
export interface Envelope<D = Record<string, unknown>> {
  ok: boolean;
  data?: D;
  messages?: Message[];
}

/**
 * Базовий клас UI-компонента моделі.
 *
 * Ідея: `$root` — це типізоване **дзеркало схеми моделі**, а не «мішок даних».
 *  - ініціалізується через `Value.Create(schema)` (з урахуванням `default`),
 *    тож поля існують ще до першого рендеру — жодних `undefined`;
 *  - реактивний завдяки `deep()` (Proxy: реагує на будь-який ключ і вкладеність)
 *    у парі з `SignalWatcher` — читання в `render()` трекаються, запис перемальовує.
 *
 * Транспорт — шина (`data.load` / `data.save`), конверт `{ ok, data, messages }`.
 * `$root` тримає лише дані моделі; транзієнтний UI-стан (`running`, `messages`) —
 * окремо, у Lit `@state`.
 *
 * Підклас зобов'язаний задати `model` і передати схему в `super(...)`.
 */
export abstract class BaseUI<T extends Record<string, unknown>>
  extends SignalWatcher(GlobalStyledLitElement) {

  /** Локалізатор — доступний у render підкласу: `this.t("common.save")`. */
  protected t = t;

  /** Ім'я моделі, напр. `"bank"`. */
  protected abstract readonly model: string;

  /** Реактивний контейнер даних форми (побудований зі схеми). */
  protected $root: T;

  /** Ім'я команди, що зараз виконується (`null` — простій). Транзієнтний UI-стан. */
  @state() protected running: string | null = null;

  /** Повідомлення з останньої відповіді сервера. Транзієнтний UI-стан. */
  @state() protected messages: Message[] = [];

  /** Чи є команда в польоті. */
  protected get busy(): boolean {
    return this.running !== null;
  }

  constructor(schema: TSchema) {
    super();
    // Value.Create будує валідне значення зі схеми; deep робить його реактивним.
    this.$root = deep(Value.Create(schema) as T);
  }

  /**
   * Виклик команди моделі через шину. Розгортає конверт,
   * наповнює `messages`, керує `running`.
   * @param kind — `"save"` додатково емітить `model.changed` (через data-service).
   */
  protected async run<D = Record<string, unknown>>(
    command: string,
    payload: unknown,
    kind: "load" | "save" = "load",
  ): Promise<Envelope<D>> {
    this.running = command;
    try {
      const env = (await bus.request(
        kind === "save" ? "data.save" : "data.load",
        { model: this.model, command, payload },
      )) as Envelope<D> | undefined;
      this.messages = env?.messages ?? [];
      return env ?? { ok: false };
    } finally {
      this.running = null;
    }
  }

  /** Часткове злиття патча у реактивний `$root` (лише наявні ключі патча). */
  protected assign(patch: Partial<T>): void {
    for (const key of Object.keys(patch) as (keyof T)[]) {
      this.$root[key] = patch[key] as T[keyof T];
    }
  }

  /**
   * Прив'язка текстового інпута до поля `$root`:
   * `.value=${this.$root.code ?? ""} @input=${this.bind("code")}`.
   */
  protected bind(field: keyof T) {
    return (e: Event) => {
      this.$root[field] = (e.target as HTMLInputElement).value as T[keyof T];
    };
  }
}
