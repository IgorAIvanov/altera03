import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import { apiFetch, readEnvelope } from "@client/data/api.ts";
import { dateFormat, formatDate } from "@client/shared/datetime.ts";
import { t } from "@client/locale.ts";
import "@client/ui-kit/components/ui-dialog.ts";

export const tagName = "access-token-dialog";

/**
 * Мої персональні токени доступу — видати, подивитися, відкликати.
 *
 * ЧОМУ ТУТ, А НЕ ОКРЕМИМ ЕКРАНОМ. Токен — це «моє», як власний пароль, і живе
 * він поруч зі зміною пароля з тієї самої причини, з якої не є моделлю: модель
 * вимагала б прав на неї в кожного користувача, і забутий адміністратором
 * доступ означав би «агента не завести». Тому меню користувача, а не розділ у
 * лівій панелі.
 *
 * ЧОМУ ЦЕ ВЗАГАЛІ ПОТРІБНО. Без екрана токен беруть дев-задачею з репозиторію
 * (`deno task token`), тобто на встановленій системі не беруть ніяк: обгортку
 * MCP не підключити, скрипт не написати, інтеграцію не завести.
 *
 * Значення показується ОДИН раз — далі в базі лише хеш, і другого способу його
 * дізнатися немає. Тому свіжий токен лишається на екрані, доки людина сама не
 * закриє вікно, а не зникає після оновлення списку.
 */

interface AccessTokenRow {
  id: string;
  name: string;
  isReadOnly: boolean;
  createdAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  status: "active" | "expired" | "revoked";
}

/** Рядок журналу токена — `app.access_token_log`. */
interface AccessTokenLogRow {
  id: string;
  occurredAt: string;
  model: string;
  command: string;
  recordId: string | null;
  isSuccess: boolean;
}

@customElement(tagName)
export class AccessTokenDialog extends GlobalStyledLitElement {
  /**
   * Стан вікна тримає власник, а `<ui-dialog>` його лише показує: закриття
   * приходить сюди подією `ui-dialog-close`.
   */
  @state() private opened = false;

  @state() private rows: AccessTokenRow[] = [];
  @state() private name = "";
  @state() private readOnly = true;
  @state() private days = "";
  @state() private issued: string | null = null;
  @state() private copied = false;
  @state() private error = "";
  @state() private busy = false;
  /** Токен, у якого спитали «точно відкликати?» — підтвердження в тому ж рядку. */
  @state() private confirming: string | null = null;
  /**
   * Токен, чий журнал розгорнуто. Відповідає за дії агента власник токена,
   * тож і бачить їх він — тут, без права на екран журналу аудиту.
   */
  @state() private logFor: string | null = null;
  @state() private logRows: AccessTokenLogRow[] = [];
  /**
   * Назва моделі. Хелпер тягне реєстр моделей, а вікно лежить в основному
   * чанку оболонки — тому він вантажиться лише тоді, коли журнал відкрили.
   */
  private modelTitle: (key: string) => string = (key) => key;

  open(): void {
    this.name = "";
    this.readOnly = true;
    this.days = "";
    this.issued = null;
    this.copied = false;
    this.error = "";
    this.confirming = null;
    this.logFor = null;
    this.logRows = [];
    this.opened = true;
    void this.load();
  }

  #close = () => { this.opened = false; };

  override render(): TemplateResult {
    return html`
      <ui-dialog
        .open=${this.opened}
        heading=${t("header.tokensTitle")}
        style="--ui-dialog-width: 38rem"
        @ui-dialog-close=${this.#close}
      >
        <div class="flex flex-col gap-4">
          ${this.issued ? this.renderIssued() : this.renderForm()}
          ${this.error ? html`<div class="text-error text-sm">${this.error}</div>` : nothing}
          ${this.renderList()}
          ${this.logFor ? this.renderLog() : nothing}
        </div>
        <div slot="actions">
          <button class="btn btn-sm" @click=${this.#close}>${t("common.close")}</button>
        </div>
      </ui-dialog>
    `;
  }

  private renderForm(): TemplateResult {
    return html`
      <form class="flex flex-col gap-3 border rounded p-3" @submit=${this.issue}>
        <div class="flex gap-2 items-end flex-wrap">
          <label class="flex flex-col gap-1 grow">
            <span class="text-sm">${t("header.tokensName")}</span>
            <input class="input" .value=${this.name} required
                   placeholder=${t("header.tokensNameHint")}
                   @input=${(e: Event) => this.name = (e.target as HTMLInputElement).value} />
          </label>

          <label class="flex flex-col gap-1 w-32">
            <span class="text-sm">${t("header.tokensDays")}</span>
            <input class="input" type="number" min="1" .value=${this.days}
                   placeholder=${t("header.tokensDaysHint")}
                   @input=${(e: Event) => this.days = (e.target as HTMLInputElement).value} />
          </label>
        </div>

        <!-- Умовчання — «тільки читання», і воно не перестраховка: токен
             успадковує ВСІ права свого користувача, а видають його звичайно для
             роботи, де запис не потрібен. -->
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="checkbox" .checked=${this.readOnly}
                 @change=${(e: Event) => this.readOnly = (e.target as HTMLInputElement).checked} />
          ${t("header.tokensReadOnly")}
        </label>

        <div class="flex justify-end">
          <button class="btn btn-primary" ?disabled=${this.busy}>${t("header.tokensIssue")}</button>
        </div>
      </form>
    `;
  }

  private renderIssued(): TemplateResult {
    return html`
      <div class="flex flex-col gap-2 border rounded p-3">
        <strong class="text-sm">${t("header.tokensIssued")}</strong>
        <code class="text-sm break-all select-all bg-base-200 rounded p-2">${this.issued}</code>
        <p class="text-sm opacity-70">${t("header.tokensIssuedHint")}</p>
        <div class="flex justify-end gap-2">
          <button class="btn btn-sm" @click=${this.copy}>
            ${this.copied ? t("header.tokensCopied") : t("header.tokensCopy")}
          </button>
          <button class="btn btn-sm btn-primary" @click=${() => this.issued = null}>
            ${t("common.close")}
          </button>
        </div>
      </div>
    `;
  }

  private renderList(): TemplateResult {
    if (this.rows.length === 0) {
      return html`<p class="text-sm opacity-70">${t("header.tokensEmpty")}</p>`;
    }

    return html`
      <table class="table table-sm">
        <thead>
          <tr>
            <th>${t("header.tokensName")}</th>
            <th>${t("header.tokensRights")}</th>
            <th>${t("header.tokensLastUsed")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.rows.map((row) => this.renderRow(row))}
        </tbody>
      </table>
    `;
  }

  private renderRow(row: AccessTokenRow): TemplateResult {
    const inactive = row.status !== "active";
    return html`
      <tr class=${inactive ? "opacity-50" : ""}>
        <td>
          ${row.name}
          ${inactive
        ? html`<span class="text-xs opacity-70"> · ${t(`header.tokensStatus.${row.status}`)}</span>`
        : nothing}
          ${row.expiresAt && !inactive
        ? html`<span class="text-xs opacity-70"> · ${t("header.tokensUntil")} ${
          formatDate(row.expiresAt, dateFormat.date)
        }</span>`
        : nothing}
        </td>
        <td class="text-sm">
          ${row.isReadOnly ? t("header.tokensReadOnlyShort") : t("header.tokensWriteShort")}
        </td>
        <!-- Порожньо означає «жодного разу»: саме за цим і видно, який токен
             можна відкликати без побоювань. -->
        <td class="text-sm">${formatDate(row.lastUsedAt, dateFormat.dateTime) || "—"}</td>
        <td class="text-right whitespace-nowrap">
          <!-- Журнал — і в відкликаного токена теж: що він встиг зробити до
               відкликання, питають якраз тоді. -->
          <button class="btn btn-sm btn-ghost" aria-pressed=${this.logFor === row.id ? "true" : "false"}
            @click=${() => this.toggleLog(row.id)}>
            ${t("header.tokensLog")}
          </button>
          ${inactive ? nothing : this.confirming === row.id
        ? html`
          <button class="btn btn-sm btn-error" @click=${() => this.revoke(row.id)}>
            ${t("header.tokensRevokeConfirm")}
          </button>
          <button class="btn btn-sm" @click=${() => this.confirming = null}>
            ${t("common.cancel")}
          </button>`
        : html`
          <button class="btn btn-sm" @click=${() => this.confirming = row.id}>
            ${t("header.tokensRevoke")}
          </button>`}
        </td>
      </tr>
    `;
  }

  private renderLog(): TemplateResult {
    const token = this.rows.find((row) => row.id === this.logFor);
    return html`
      <div class="flex flex-col gap-2">
        <strong class="text-sm">${t("header.tokensLogTitle")}: ${token?.name ?? ""}</strong>
        ${this.logRows.length === 0
      ? html`<p class="text-sm opacity-70">${t("header.tokensLogEmpty")}</p>`
      : html`
        <div class="max-h-64 overflow-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>${t("header.tokensLogTime")}</th>
                <th>${t("header.tokensLogAction")}</th>
                <th class="text-right">${t("header.tokensLogRecord")}</th>
                <th>${t("header.tokensLogResult")}</th>
              </tr>
            </thead>
            <tbody>
              ${this.logRows.map((row) => html`
                <tr>
                  <td class="text-sm tabular-nums">${formatDate(row.occurredAt, dateFormat.dateTime)}</td>
                  <td class="text-sm" title=${`${row.model}/${row.command}`}>
                    ${this.modelTitle(row.model)} · ${row.command}
                  </td>
                  <td class="text-sm text-right tabular-nums">${row.recordId ?? ""}</td>
                  <td class=${`text-sm ${row.isSuccess ? "" : "text-error"}`}>
                    ${row.isSuccess ? t("header.tokensLogSuccess") : t("header.tokensLogFailure")}
                  </td>
                </tr>`)}
            </tbody>
          </table>
        </div>`}
      </div>
    `;
  }

  private async toggleLog(id: string): Promise<void> {
    if (this.logFor === id) {
      this.logFor = null;
      return;
    }
    this.error = "";
    try {
      const [{ modelTitle }, response] = await Promise.all([
        import("@shared/model-title.ts"),
        apiFetch(`/api/auth/tokens/log?id=${encodeURIComponent(id)}`),
      ]);
      const envelope = await readEnvelope<unknown, AccessTokenLogRow>(response);
      if (!envelope.ok) throw new Error(messageText(envelope.messages[0]));
      this.modelTitle = modelTitle;
      this.logRows = envelope.data.rows;
      this.logFor = id;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async load(): Promise<void> {
    try {
      const envelope = await readEnvelope<unknown, AccessTokenRow>(
        await apiFetch("/api/auth/tokens"),
      );
      if (!envelope.ok) throw new Error(String(envelope.messages[0] ?? ""));
      this.rows = envelope.data.rows;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  private issue = async (event: Event) => {
    event.preventDefault();
    this.busy = true;
    this.error = "";
    this.copied = false;

    try {
      const days = Number.parseInt(this.days, 10);
      const envelope = await readEnvelope<{ token?: string }>(
        await apiFetch("/api/auth/tokens", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: this.name.trim(),
            isReadOnly: this.readOnly,
            ...(Number.isFinite(days) && days > 0 ? { expiresInDays: days } : {}),
          }),
        }),
      );

      if (!envelope.ok) throw new Error(messageText(envelope.messages[0]));

      this.issued = envelope.data.item?.token ?? null;
      this.name = "";
      this.days = "";
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  };

  private async revoke(id: string): Promise<void> {
    this.confirming = null;
    this.error = "";

    try {
      const envelope = await readEnvelope(
        await apiFetch("/api/auth/tokens/revoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        }),
      );
      if (!envelope.ok) throw new Error(messageText(envelope.messages[0]));
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Копіювання може бути недоступне (несекурний контекст), і мовчазна невдача
   * тут найгірша: людина закриє вікно, вважаючи, що значення в буфері, а другого
   * разу побачити його вже не можна.
   */
  private copy = async () => {
    if (!this.issued) return;
    try {
      await navigator.clipboard.writeText(this.issued);
      this.copied = true;
    } catch {
      this.error = t("header.tokensCopyFailed");
    }
  };
}

/** Повідомлення конверта: рядком або об'єктом `{type, text}`. */
function messageText(message: unknown): string {
  if (typeof message === "string") return message;
  const text = (message as { text?: unknown })?.text;
  return typeof text === "string" ? text : "";
}
