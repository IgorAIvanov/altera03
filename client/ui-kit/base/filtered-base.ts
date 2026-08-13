import { BaseUI } from "./base-ui.ts";

/**
 * Стан і прив'язка передвизначених фільтрів (`отбори`) — спільне для табличних
 * екранів і звітів.
 *
 * Тут навмисно НЕМАЄ розмітки й жодного імпорту компонента: набір фільтрів свій
 * у кожного екрана, а найчастіші в обліку — дата й період, тобто `<ui-date>` і
 * `<ui-period>`. Опиши основа види фільтрів переліком — вона б статично
 * імпортувала ці компоненти, і за них платив би кожен список, кожен діалог
 * підбору й кожен звіт (див. скіл `framework-ui-internals`, розділ про граф
 * чанків). Основа дає три речі: стан, прив'язку і гак «фільтри змінилися».
 *
 * Розділяються нащадки саме цим гаком, і різниця між ними не випадкова:
 * список перезапитує НЕГАЙНО (сторінка даних дешева), звіт — ні, його формує
 * «Оновити» (оборотка за рік коштує стільки, що ганяти її на кожен клац по
 * фільтру не можна), тож він лише позначає себе застарілим. Тому
 * `onFiltersChanged()` тут порожній, а перевизначає його той, кому це потрібно.
 *
 * Куди їдуть значення — `filtersPayload()`: вкладеним об'єктом `filters`, а не
 * врозсип, бо ім'я фільтра рано чи пізно збіглося б із полем запиту (`page`,
 * `search`). SQL читає їх як `payload->'filters'->>'…'`.
 *
 * ## Ссылочний фільтр — ОДИН ключ з об'єктом
 *
 * `{ id, <display> }`: id вибирає записи, представлення малює пікер. У SQL з
 * нього береться сам лише `id`, а назад під тим самим ключем приходить об'єкт,
 * зібраний з того id і підпису з бази, — відповідь уточнює фільтр, а не додає
 * до нього другий.
 *
 * Пара «`counterpartyId` + окремий `counterparty`» виглядає природною й коштує
 * двох тихих вад: лічильник діючих фільтрів рахує підпис за другий фільтр, а
 * при скиданні id підпис лишається в наборі назавжди — клієнт шле його назад
 * незміненим, а сервер незмінним і повертає.
 */
export abstract class FilteredBase<Root extends Record<string, unknown>> extends BaseUI<Root> {
  /** Затримка для того, що набирають руками. Вибір зі списку її не потребує. */
  protected filterDebounceMs = 300;

  // ReturnType<typeof setTimeout>, а не number: пакет типізується і з DOM-lib,
  // і з @types/node, а там setTimeout повертає Timeout.
  #timer?: ReturnType<typeof setTimeout>;

  /** Порожній набір для читання з кореня, у якому `$filters` не оголошено. */
  static readonly #NONE: Record<string, unknown> = Object.freeze({});

  /**
   * Набір фільтрів у `$root`. Через приведення, а не типом: корені екранів
   * різні (у списку `ListRoot`, у звіту свій), і спільне в них саме це поле.
   */
  protected get filters(): Record<string, unknown> {
    return (this.$root as Record<string, unknown>).$filters as Record<string, unknown>
      ?? FilteredBase.#NONE;
  }

  /**
   * Той самий набір для ЗАПИСУ. Окремо від читання, бо мовчазна відмова тут
   * була б найгіршою з можливих: фільтр ставився б у нікуди, екран не міняв би
   * нічого, і шукати причину довелося б у SQL. Тому — гучно й одразу.
   */
  #mutable(): Record<string, unknown> {
    const value = (this.$root as Record<string, unknown>).$filters;
    if (!value || typeof value !== "object") {
      throw new Error(
        `${this.model}: у кореневій схемі екрана немає \`$filters\` — ` +
          "фільтри нікуди писати. Додай його в <Model>RootSchema.",
      );
    }
    return value as Record<string, unknown>;
  }

  /**
   * Поточне значення фільтра. `undefined` — не заданий.
   *
   * У ссылочного фільтра це об'єкт `{ id, <display> }` — рівно те, що приймає
   * `<ui-picker>` властивістю `value`.
   */
  protected filterValue<T = unknown>(key: string): T | undefined {
    return this.filters[key] as T | undefined;
  }

  /** Записати один фільтр. */
  protected setFilter(key: string, value: unknown, opts: { debounce?: boolean } = {}) {
    this.setFilters({ [key]: value }, opts);
  }

  /**
   * Записати кілька фільтрів однією дією.
   *
   * Потрібне частіше, ніж здається: `<ui-period>` віддає межі періоду ПАРОЮ, і
   * два послідовні `setFilter` дали б два запити, другий з яких скасував би
   * перший.
   */
  protected setFilters(patch: Record<string, unknown>, opts: { debounce?: boolean } = {}) {
    const filters = this.#mutable();
    for (const [key, value] of Object.entries(patch)) {
      // Порожнє значення не зберігаємо, а ВИДАЛЯЄМО. Завдяки цьому «скільки
      // фільтрів діє» і «що слати на сервер» — це просто вміст набору, без
      // окремої таблиці правил; а SQL не мусить розрізняти «не задано» і
      // «задано порожнім».
      if (value === undefined || value === null || value === "" || value === false) {
        delete filters[key];
      } else {
        filters[key] = value;
      }
    }
    clearTimeout(this.#timer);
    if (opts.debounce) {
      this.#timer = setTimeout(() => this.onFiltersChanged(), this.filterDebounceMs);
    } else {
      this.onFiltersChanged();
    }
  }

  /**
   * Записати фільтр БЕЗ перезапиту — для умовчань, які сіються ДО першого
   * завантаження (відбір за організацією в журналі документів).
   *
   * Окремо від `setFilter`, бо тут не має бути гака: звичайний запис попросив
   * би перезавантажити екран, який ще нічого не завантажував, — тобто зайвий
   * запит, а в списку ще й блимання чужих даних між двома відповідями.
   */
  protected seedFilter(key: string, value: unknown) {
    if (value === undefined || value === null || value === "") return;
    this.#mutable()[key] = value;
  }

  /**
   * Прив'язка НАТИВНОГО контрола до фільтра — рівно як `BaseUI.bindTo` для
   * полів форми: `@input=${this.bindFilter("number", { debounce: true })}`.
   *
   * Компоненти ui-kit подіями не однакові (`value-changed`,
   * `period-changed`, у кожного своя структура `detail`), тому їх екран
   * зв'язує сам через `setFilter`.
   */
  protected bindFilter(key: string, opts: { debounce?: boolean } = {}): (e: Event) => void {
    return (e: Event) => {
      const target = e.target as HTMLInputElement;
      const value = target.type === "checkbox" ? target.checked : target.value;
      this.setFilter(key, value, opts);
    };
  }

  /**
   * Відбори, з якими екран ВІДКРИВАЄТЬСЯ, — і саме до них повертає «Скинути».
   *
   * Порожньо за умовчанням: у довідника відкритий стан і є «без відборів».
   * Журнал документів інший — він відкривається звуженим на поточну
   * організацію й на період із налаштувань користувача, і це не примха: журнал
   * за ВЕСЬ час — найдорожчий запит екрана, а без організації він показує суміш
   * двох обліків. Тобто відбір там не прикраса, а умова придатності.
   *
   * Доти «Скинути» чистив набір ДОЩЕНТУ, і виходили дві правильні поведінки,
   * що суперечать одна одній: основа сіяла організацію навмисно, а кнопка
   * поруч її знімала. Тепер обидві кажуть те саме, бо джерело одне — цей метод.
   *
   * Нащадок, що додає своє, мусить кликати `super.defaultFilters()`, інакше
   * мовчки прибере умовчання основи.
   */
  protected defaultFilters(): Record<string, unknown> {
    return {};
  }

  /** Чи стоїть екран рівно на своїх умовчаннях — тоді скидати нічого. */
  protected get filtersAreDefault(): boolean {
    const current = this.filters;
    const defaults = this.defaultFilters();
    const keys = new Set([...Object.keys(current), ...Object.keys(defaults)]);

    for (const key of keys) {
      if (JSON.stringify(current[key]) !== JSON.stringify(defaults[key])) return false;
    }
    return true;
  }

  /**
   * Скинути відбори до умовчань екрана. Знати їх поіменно не треба — набір і є
   * весь перелік, а умовчання оголошує `defaultFilters()`.
   */
  protected resetFilters() {
    const filters = this.#mutable();
    for (const key of Object.keys(filters)) delete filters[key];

    // Те саме правило порожнечі, що в `setFilters`: порожнє значення не
    // зберігається, а відсутнє. Інакше умовчання-порожнеча рахувалося б за
    // діючий відбір і сиділо б у payload.
    for (const [key, value] of Object.entries(this.defaultFilters())) {
      if (value === undefined || value === null || value === "" || value === false) continue;
      filters[key] = value;
    }

    this.onFiltersChanged();
  }

  /**
   * Скільки фільтрів діє. Довжина набору, і вона чесна рівно тому, що
   * ссылочний фільтр займає ОДИН ключ.
   */
  protected get activeFilterCount(): number {
    return Object.keys(this.filters).length;
  }

  /**
   * Фільтри в payload — вкладеним об'єктом. Ключа немає зовсім, коли фільтрів
   * немає, щоб у SQL вистачало `coalesce`, а не перевірки на порожній об'єкт.
   */
  protected filtersPayload(): Record<string, unknown> {
    const filters = this.filters;
    return Object.keys(filters).length ? { filters } : {};
  }

  /**
   * Фільтри змінилися. Список перезапитує з першої сторінки; звіт лише
   * позначає себе застарілим — формує його «Оновити».
   */
  protected onFiltersChanged(): void {}
}
