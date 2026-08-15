import { html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI, type FieldRules } from "@client/ui-kit/base/base-ui.ts";
import { dateFormat, formatDate } from "@client/shared/datetime.ts";
import {
  REMARK_KINDS,
  REMARK_STATUSES,
  RemarkEditRootSchema,
  type RemarkEditRoot,
} from "./remark.schema.ts";
import { remarkBadge } from "./remark-status.ts";
import "@client/ui-kit/components/ui-attachments.ts";

export const tagName = "remark-edit";

@customElement(tagName)
export class RemarkEdit extends BaseUI<RemarkEditRoot> {
  protected model = "remark";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(RemarkEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  /**
   * Закритий запис не редагується.
   *
   * Це той самий замок, яким документ закривається після проведення, і знімає
   * його теж людина — кнопкою «Не виправлено». Прав тут немає: закритість не
   * про повноваження, а про те, що суперечку вже завершили.
   */
  protected override get locked(): boolean {
    return !!this.$root.item.verifiedAt;
  }

  protected override fieldRules(): FieldRules {
    return { title: true };
  }

  /**
   * Дві кнопки людини. Стоять у панелі, тобто ПОЗА `fieldset[disabled]`, —
   * інакше на закритому записі вони згасли б разом із полями, і зняти закриття
   * не було б чим.
   */
  protected override renderActions(): TemplateResult | string {
    const item = this.$root.item;
    if (!item.id || !item.answer) return "";

    if (item.verifiedAt) {
      return html`
        <button class="btn btn-sm" ?disabled=${this.busy} @click=${this.#reopen}>
          ${this.t("remark.notFixed")}
        </button>
      `;
    }
    return html`
      <button class="btn btn-sm btn-primary" ?disabled=${this.busy} @click=${this.#close}>
        ${this.t("remark.verifyClose")}
      </button>
      <button class="btn btn-sm" ?disabled=${this.busy} @click=${this.#reopen}>
        ${this.t("remark.notFixed")}
      </button>
    `;
  }

  /**
   * Зберегти обробку — тією самою командою `answer`, якою відповідає агент.
   *
   * Окремої команди «для людини» тут немає навмисно: сторону визначає не хто
   * набрав, а ЩО пишеться. Прапорець `ownerDecision` каже ядру, що замовлення в
   * роботу переводить власник рішення, а не виконавець (див. remark_answer).
   */
  #saveWork = async () => {
    const item = this.$root.item;
    await this.loadInto("answer", {
      id: item.id,
      status: item.status,
      area: item.area,
      answer: item.answer ?? "",
      fixedVersion: item.fixedVersion,
      feedbackRef: item.feedbackRef,
      ownerDecision: true,
    }, "save");
  };

  #close = () => this.loadInto("verify", { id: this.$root.item.id, confirmed: true }, "save");
  #reopen = () => this.loadInto("verify", { id: this.$root.item.id, confirmed: false }, "save");

  /** Рядок довідки «підпис — значення» для блоків, які лише показують. */
  #fact(label: string, value: string | null): TemplateResult | string {
    if (!value) return "";
    return html`
      <div class="flex gap-2 text-sm">
        <span class="opacity-60 shrink-0 w-40">${label}</span>
        <span class="break-all">${value}</span>
      </div>
    `;
  }

  override render() {
    if (this.running === "get") {
      return html`
        <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
      `;
    }

    const item = this.$root.item;

    return this.renderForm(html`
      <div class="flex flex-col gap-3">
        ${this.renderField(
          this.t("remark.kind"),
          html`
            <select class="select select-bordered w-full" .value=${item.kind}
              @change=${(e: Event) => { item.kind = (e.target as HTMLSelectElement).value; }}>
              ${REMARK_KINDS.map((k) =>
                html`<option value=${k} ?selected=${item.kind === k}>${this.t(`remark.kind.${k}`)}</option>`
              )}
            </select>
          `,
          { field: "kind", class: "w-56" },
        )}

        ${this.renderField(
          this.t("remark.title"),
          html`<input class="input input-bordered w-full" .value=${item.title ?? ""}
            @input=${this.bindTo(item, "title")} />`,
          { field: "title" },
        )}

        ${this.renderField(
          this.t("remark.body"),
          html`<textarea class="textarea textarea-bordered w-full" rows="5"
            .value=${item.body ?? ""} @input=${this.bindTo(item, "body")}></textarea>`,
          { field: "body" },
        )}

        ${item.id
          ? html`
            <!-- Знімок екрана лежить звичайним вкладенням (owner_model =
                 "remark"), тож окремого показу йому не треба — тут той самий
                 компонент, що у документів. -->
            <ui-attachments
              .label=${this.t("remark.attachments")}
              owner-model="remark"
              owner-id=${item.id}
              ?disabled=${this.readonlyMode}
            ></ui-attachments>`
          : ""}

        ${item.id ? this.#renderContext() : ""}
        ${item.id ? this.#renderWork() : ""}
      </div>
    `);
  }

  /**
   * Контекст — тільки показ, і правити його не можна взагалі: він знятий у мить,
   * коли випадок був на екрані. Саме з `ctxRoute` виконавець відкриває той самий
   * запис, тому маршрут стоїть першим і моноширинним.
   */
  #renderContext(): TemplateResult {
    const item = this.$root.item;
    return html`
      <div class="rounded-box bg-base-200 px-3 py-2 flex flex-col gap-1">
        <div class="text-sm opacity-60">${this.t("remark.context")}</div>
        ${item.ctxRoute
          ? html`
            <div class="flex gap-2 text-sm">
              <span class="opacity-60 shrink-0 w-40">${this.t("remark.ctxRoute")}</span>
              <span class="font-mono break-all">${item.ctxRoute}</span>
            </div>`
          : ""}
        ${this.#fact(this.t("remark.author"), item.author)}
        ${this.#fact(this.t("remark.createdAt"), formatDate(item.createdAt, dateFormat.dateTime))}
        ${this.#fact(this.t("remark.ctxSolution"), item.ctxSolution)}
        ${this.#fact(this.t("remark.ctxFramework"), item.ctxFramework)}
      </div>
    `;
  }

  /**
   * Обробка — сторона виконавця. Тут її бачать і люди, і агент: агент пише те
   * саме командою `answer`, а форма показує написане й дозволяє поправити.
   *
   * Стан лишається ЗАЯВОЮ виконавця: закриває запис усе одно людина кнопкою
   * «Перевірив», і саме тому поруч зі станом стоїть значок — щоб було видно,
   * чия зараз черга.
   */
  #renderWork(): TemplateResult {
    const item = this.$root.item;
    return html`
      <div class="rounded-box border border-base-300 px-3 py-2 flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span class="text-sm opacity-60">${this.t("remark.work")}</span>
          <span class="badge badge-sm ${remarkBadge(item.status, item.verifiedAt)}">
            ${item.verifiedAt ? this.t("remark.closed") : this.t(`remark.status.${item.status}`)}
          </span>
        </div>

        <div class="flex gap-3 flex-wrap">
          ${this.renderField(
            this.t("remark.status"),
            html`
              <select class="select select-bordered w-full" .value=${item.status}
                @change=${(e: Event) => { item.status = (e.target as HTMLSelectElement).value; }}>
                ${REMARK_STATUSES.map((v) =>
                  html`<option value=${v} ?selected=${item.status === v}>${this.t(`remark.status.${v}`)}</option>`
                )}
              </select>`,
            { field: "status", class: "w-48" },
          )}

          ${this.renderField(
            this.t("remark.area"),
            html`
              <select class="select select-bordered w-full" .value=${item.area ?? ""}
                @change=${(e: Event) => { item.area = (e.target as HTMLSelectElement).value || null; }}>
                <option value="">—</option>
                <option value="solution" ?selected=${item.area === "solution"}>${this.t("remark.area.solution")}</option>
                <option value="framework" ?selected=${item.area === "framework"}>${this.t("remark.area.framework")}</option>
              </select>`,
            { field: "area", class: "w-48" },
          )}

          ${this.renderField(
            this.t("remark.fixedVersion"),
            html`<input class="input input-bordered w-full" .value=${item.fixedVersion ?? ""}
              @input=${this.bindTo(item, "fixedVersion")} />`,
            { field: "fixedVersion", class: "w-56" },
          )}
        </div>

        ${this.renderField(
          this.t("remark.answer"),
          html`<textarea class="textarea textarea-bordered w-full" rows="4"
            .value=${item.answer ?? ""} @input=${this.bindTo(item, "answer")}></textarea>`,
          { field: "answer" },
        )}

        ${this.renderField(
          this.t("remark.feedbackRef"),
          html`<input class="input input-bordered w-full" .value=${item.feedbackRef ?? ""}
            @input=${this.bindTo(item, "feedbackRef")} />`,
          { field: "feedbackRef" },
        )}

        <div class="flex items-center gap-3">
          <button class="btn btn-sm" ?disabled=${this.busy} @click=${this.#saveWork}>
            ${this.t("remark.saveWork")}
          </button>
          ${item.answeredAt
            ? html`<span class="text-sm opacity-60">
                ${this.t("remark.answeredAt")}: ${formatDate(item.answeredAt, dateFormat.dateTime)}
              </span>`
            : ""}
        </div>
      </div>
    `;
  }
}
