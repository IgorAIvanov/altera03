/**
 * Колір стану зауваження — один на список і на форму.
 *
 * Кольори не декоративні, вони кажуть, чия зараз черга: сіре — ще нічого не
 * робили, жовте — у роботі, синє — відповідь є й чекає на людину, зелене —
 * зроблено, червоне — відхилено. Тримати цю відповідність у двох місцях означало
 * б, що список і форма колись розійдуться, і саме на записі, який шукають.
 */
export const REMARK_STATUS_BADGE: Record<string, string> = {
  new: "badge-ghost",
  in_work: "badge-warning",
  answered: "badge-info",
  fixed: "badge-success",
  rejected: "badge-error",
};

/**
 * Клас для стану рядка.
 *
 * Закритий запис (`verifiedAt`) забиває будь-який стан: закритість — факт від
 * людини, а стан лишається заявкою виконавця, і показувати заявку там, де вже є
 * факт, означає показувати старе.
 */
export function remarkBadge(status: string, verifiedAt: string | null): string {
  return verifiedAt ? "badge-success" : REMARK_STATUS_BADGE[status] ?? "badge-ghost";
}
