/** Переводи рядків — у LF. Спільний хелпер для перевірок «згенероване = джерело». */
export function normalizeEol(text: string): string {
  return text.replaceAll("\r\n", "\n");
}
