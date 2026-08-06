import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import { apiFetch, readEnvelope } from "@client/data/api.ts";

export const tagName = "home-tab";

/** Стан підтримки, як його віддає `GET /api/solution/status`. */
interface SolutionState {
  solution: { name: string; version: string; installedAt: string; files: number } | null;
  /** `null` — манифесту поставки немає, тобто невідомо. */
  supported: boolean | null;
  divergent: number;
}

/** Стартова вкладка. Заміни вміст на щось корисне для свого застосунку. */
@customElement(tagName)
export class HomeTab extends GlobalStyledLitElement {
  @state() private solutionState: SolutionState | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadState();
  }

  private async loadState(): Promise<void> {
    try {
      const response = await apiFetch("/api/solution/status");
      const envelope = await readEnvelope<SolutionState>(response);
      this.solutionState = envelope.data?.item ?? null;
    } catch {
      // Старіший сервер такого маршруту не має — просто нічого не показуємо.
      this.solutionState = null;
    }
  }

  override render(): TemplateResult {
    return html`
      <div class="p-6 flex flex-col gap-4 items-start">
        <div>
          <h1 class="text-xl font-medium mb-2">{{name}}</h1>
          <p class="opacity-70">
            Пункти меню редагуються в адмініструванні; моделі створюються в
            <code>app/&lt;family&gt;/&lt;model&gt;/</code>.
          </p>
        </div>

        ${this.renderSolution()}
      </div>
    `;
  }

  /**
   * Стан прикладного рішення — показ, і тільки.
   *
   * Кнопки установки тут немає навмисно: оновлює окремий інструмент
   * (`deno task solution:update`), бо той, кого заміняють, не має заміняти себе
   * сам — а серверу тоді не потрібні ані `--allow-write`, ані `--allow-run`.
   */
  private renderSolution(): TemplateResult | typeof nothing {
    const state = this.solutionState;
    if (!state?.solution) return nothing;

    const { name, version } = state.solution;

    return html`
      <div class="flex flex-col gap-1">
        <div class="font-medium">Прикладне рішення: ${name}@${version}</div>
        ${state.supported
          ? html`<div class="opacity-70">На підтримці — рішення не змінювали після поставки.</div>`
          : html`
            <div class="opacity-70">
              Знято з підтримки: ${state.divergent} файл(ів) розходяться з поставкою.
              Нова поставка не замінить їх автоматично.
            </div>
          `}
        <div class="opacity-60 text-sm">
          Стан поіменно — <code>deno task solution:status</code>; оновлення —
          <code>deno task solution:update -- &lt;пакет.tar.gz&gt;</code>
        </div>
      </div>
    `;
  }
}
