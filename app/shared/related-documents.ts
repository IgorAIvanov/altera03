import { html, type TemplateResult } from "lit";
import "@client/ui-kit/components/ui-related-documents.ts";
import { viewRoute } from "./view-route.ts";

/**
 * Кнопка «Пов'язані документи» для командної панелі форми документа.
 *
 * Дерево й вікно — у фреймворку (`<ui-related-documents>`); тут лише те, чого
 * фреймворк знати не може: маршрут форми за кодом типу документа. Він
 * виводиться з view-manifest застосунку (`viewRoute`), і без нього вузли дерева
 * показувалися б, але не відкривалися.
 *
 * Спільне місце, а не рядок у кожній формі, — та сама причина, що в
 * `movementsButton`: форм документів багато, а маршрутизатор один.
 */
export function relatedDocumentsButton(model: string, documentId: string | null | undefined): TemplateResult {
  return html`
    <ui-related-documents model=${model} .documentId=${documentId ?? ""}
      .routeOf=${(typeCode: string) => viewRoute(typeCode)}></ui-related-documents>
  `;
}
