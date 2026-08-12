import { Type, type Static } from "@sinclair/typebox";

/**
 * Каталог налаштувань установки.
 *
 * Тут — те, що видно на екрані (тип, підпис, вигляд поля). Значення за
 * замовчуванням лежить НЕ тут, а рядком у базі (`db/data.sql`): умовчання в
 * двох домівках розійшлися б на першому ж релізі, а джерелом мусить лишатися
 * те, що читає SQL.
 *
 * Ключ додається у ДВА місця — сюди й у сід. Розсинхрон не мовчазний: ключ без
 * рядка в базі показує на екрані порожнє поле, а рядок без оголошення просто не
 * малюється. Коли ключів стане більше десятка, сід варто генерувати звідси —
 * так само, як `_generated/audit-settings.data.sql` збирається з манифестів.
 */
export interface SettingField {
  key: string;
  /** Ключ перекладу підпису. */
  titleKey: string;
  kind: "int" | "bool" | "text";
  /** Підказка під полем — ключ перекладу; необов'язкова. */
  hintKey?: string;
  min?: number;
  max?: number;
}

export const SETTING_FIELDS: SettingField[] = [
  {
    key: "list.pageSize",
    titleKey: "setting.list.pageSize",
    hintKey: "setting.list.pageSizeHint",
    kind: "int",
    min: 5,
    max: 200,
  },
  {
    key: "list.exportRowLimit",
    titleKey: "setting.list.exportRowLimit",
    hintKey: "setting.list.exportRowLimitHint",
    kind: "int",
    min: 100,
    max: 100_000,
  },
];

/**
 * Значення однією мапою — так їх віддає `setting_get` і так само приймає
 * `setting_save`. Окремих полів у схемі немає навмисно: склад мапи задає
 * каталог, і дублювати його ще й типом означало б правити два місця на кожен
 * новий ключ.
 *
 * `id` — це ОБЛАСТЬ (`app`), і він тут не косметика: рантайм виводить право
 * команди `save` з наявності `item.id` — без нього збереження вимагало б права
 * `create`, тобто «створити налаштування», чого в цій моделі не буває. Коли
 * дійде черга до користувацької області, її формою стане та сама модель з
 * `id: "user"`.
 */
export const SettingItemSchema = Type.Object({
  id: Type.String({ default: "app" }),
  values: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
});
export type SettingItem = Static<typeof SettingItemSchema>;

export const SettingGetPayloadSchema = Type.Object({});
export type SettingGetPayload = Static<typeof SettingGetPayloadSchema>;

export const SettingSavePayloadSchema = Type.Object({
  item: SettingItemSchema,
});
export type SettingSavePayload = Static<typeof SettingSavePayloadSchema>;

/** Дзеркало `data` форми ($root). */
export const SettingEditRootSchema = Type.Object({
  item: SettingItemSchema,
});
export type SettingEditRoot = Static<typeof SettingEditRootSchema>;
