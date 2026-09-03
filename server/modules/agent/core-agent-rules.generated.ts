// ЗГЕНЕРОВАНО `deno task core:sql` з server/sql/**/db/*.sql — не редагувати.
//
// Правила, які оголошує ядро, за тим, кому вони стосуються: "*" — усім,
// "document" — будь-якому документу. Тексти НЕ дублюються: тут лише ключі,
// рядок береться в рантаймі зі словників повідомлень.

export const coreAgentRules: Record<string, string[]> = {
  "*": ["core.numeratorMissing"],
  "document": ["core.creditAccountIsGroup","core.creditAccountNotFound","core.debitAccountIsGroup","core.debitAccountNotFound","core.documentDeleted","core.documentNotFound","core.entryNeedsCurrency","core.entryNeedsQuantity","core.entryNoAccount","core.entryOneSidedNotOffBalance","core.entryZeroAmount","core.subcontoRequired"],
};
