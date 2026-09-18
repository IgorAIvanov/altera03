-- ═══════════════════════════════════════════════════════════════════════════
-- Процедури ядра документообігу.
--
-- Ними користуються команди post/unpost конкретних документів. Сама логіка
-- проводок лишається у видимому SQL документа (app.<model>_post_entries) —
-- декларативних правил проведення тут свідомо немає: у бухгалтерії дорожче
-- «магія», ніж кілька рядків явного коду.
--
-- Типовий post документа:
--   perform app.doc_post_begin(user_id, doc_id);
--   perform app.doc_entry_add(doc_id, 1, '361', '701', 1200.00, null, 'Реалізація',
--                             jsonb_build_object('counterparty', cp_id), '{}'::jsonb);
--   perform app.doc_post_finish(user_id, doc_id);
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Автонумерація ───────────────────────────────────────────────────────────
-- Тонка обгортка над нумератором (@core/numerator): формат номера, область
-- лічильника й стратегія живуть там і налаштовуються, а не зашиті сюди.
--
-- Обгортка лишається тому, що документ — не єдиний, хто нумерується, але
-- ЄДИНИЙ, у кого область складається сама з себе: тип відомий з моделі,
-- організація й дата — з шапки. Кличучи нумератор напряму, кожен документ
-- збирав би цей scope власноруч.
--
-- Рік береться з ДАТИ ДОКУМЕНТА: документ, уведений заднім числом, мусить
-- отримати торішній лічильник. Тому null тут допустимий лише для нумератора
-- без періоду — з періодом нумератор ВІДМОВИТЬ, бо без дати не знає, у чию
-- область писати, а мовчазний now() поклав би номер не в той рік. Генерований
-- save через це перевіряє дату ще до виклику й садить відмову на поле форми.

drop function if exists app.doc_next_number(varchar, bigint);
drop function if exists app.doc_next_number(varchar, bigint, timestamp);
create function app.doc_next_number(
  p_type_code       varchar,
  p_organization_id bigint,
  p_date            timestamp default null
) returns varchar
language plpgsql
as $$
begin
  if not exists (select 1 from app.document_type where code = p_type_code) then
    raise exception 'Невідомий тип документа «%»', p_type_code;
  end if;
  if not exists (select 1 from app.organization where id = p_organization_id) then
    raise exception 'Невідома організація %', p_organization_id;
  end if;

  return app.numerator_next(
    p_type_code,
    jsonb_build_object('orgId', p_organization_id, 'date', p_date)
  );
end;
$$;

-- Те саме для ручного номера: підтягнути лічильник, якщо користувач набрав
-- номер більший за виданий. Див. app.numerator_bump_to.

drop function if exists app.doc_bump_number(varchar, bigint, timestamp, varchar);
create function app.doc_bump_number(
  p_type_code       varchar,
  p_organization_id bigint,
  p_date            timestamp,
  p_number          varchar
) returns void
language plpgsql
as $$
begin
  perform app.numerator_bump_to(
    p_type_code,
    jsonb_build_object('orgId', p_organization_id, 'date', p_date),
    p_number
  );
end;
$$;

-- ── Аналітика проводки ──────────────────────────────────────────────────────
-- Розкладає значення субконто по слотах, які веде рахунок, і знімає з
-- довідника знімок коду та назви. Зайві ключі ігноруються, відсутнє
-- обов'язкове субконто — помилка.
--
-- p_values приймає обидві форми запису значення:
--   {"counterparty": "42"}                       — лише id;
--   {"counterparty": {"id": "42", "name": "…"}}  — id разом із представленням.
-- Друга зручна документам: форма показує назву субконто після перезавантаження,
-- не роблячи окремого запиту. Знімок для регістру ядро все одно бере з
-- довідника, а не з документа, — щоб рух не залежав від того, що там лежало.

drop function if exists app.doc_analytic_set(bigint, varchar, varchar, jsonb);
create function app.doc_analytic_set(
  p_entry_id bigint,
  p_side     varchar,
  p_account  varchar,
  p_values   jsonb
) returns void
language plpgsql
as $$
declare
  cfg    record;
  v_raw  jsonb;
  v_id   bigint;
  v_code varchar(100);
  v_name varchar(500);
begin
  for cfg in
    select
      a.slot_no,
      a.dimension_code,
      a.is_required,
      d.name as dimension_name,
      d.target_table,
      d.id_column,
      d.code_column,
      d.name_column
    from app.chart_of_account_analytic a
    join app.analytic_dimension d on d.code = a.dimension_code
    where a.account_code = p_account
    order by a.slot_no
  loop
    v_raw := coalesce(p_values, '{}'::jsonb) -> cfg.dimension_code;
    v_id := case
      when v_raw is null or jsonb_typeof(v_raw) = 'null' then null
      when jsonb_typeof(v_raw) = 'object' then nullif(v_raw ->> 'id', '')::bigint
      else nullif(v_raw #>> '{}', '')::bigint
    end;

    if v_id is null then
      if cfg.is_required then
        raise exception '@[core.subcontoRequired]%',
          jsonb_build_object('dimension', cfg.dimension_name, 'account', p_account, 'side', p_side)::text;
      end if;
      continue;
    end if;

    begin
      execute format(
        'select %s::varchar, %s::varchar from %s where %I = $1',
        coalesce(quote_ident(cfg.code_column), 'null'),
        coalesce(quote_ident(cfg.name_column), 'null'),
        cfg.target_table,
        cfg.id_column
      )
      into strict v_code, v_name
      using v_id;
    exception when no_data_found then
      raise exception 'Субконто «%»: запис % не знайдено в %',
        cfg.dimension_name, v_id, cfg.target_table;
    end;

    insert into app.journal_entry_analytic (
      journal_entry_id, side, slot_no, dimension_code,
      value_id, value_code, value_name, value_presentation
    )
    values (
      p_entry_id, p_side, cfg.slot_no, cfg.dimension_code,
      v_id, v_code, v_name, coalesce(v_name, v_code, v_id::text)
    )
    on conflict (journal_entry_id, side, slot_no) do update
    set
      dimension_code     = excluded.dimension_code,
      value_id           = excluded.value_id,
      value_code         = excluded.value_code,
      value_name         = excluded.value_name,
      value_presentation = excluded.value_presentation;
  end loop;
end;
$$;

-- ── Початок проведення ──────────────────────────────────────────────────────
-- Перевіряє документ і зносить попередні рухи: перепроведення завжди
-- переписує регістр начисто, часткового оновлення проводок не буває.

drop function if exists app.doc_post_begin(bigint, bigint);
create function app.doc_post_begin(
  p_user_id     bigint,
  p_document_id bigint
) returns void
language plpgsql
as $$
declare
  v_doc record;
begin
  -- `for update` серіалізує паралельні проведення того самого документа: без
  -- нього двоє встигали видалити старі проводки й почати писати нові, і другий
  -- падав на unique(document_id, line_no) — помилкою про «дубль рядка», за два
  -- кроки від причини. Тепер другий просто чекає першого й переписує начисто.
  select id, is_deleted into v_doc
  from app.document
  where id = p_document_id
  for update;

  if not found then
    raise exception '@[core.documentNotFound]%', jsonb_build_object('id', p_document_id)::text;
  end if;

  if v_doc.is_deleted then
    raise exception '@[core.documentDeleted]%', jsonb_build_object('id', p_document_id)::text;
  end if;

  delete from app.journal_entry where document_id = p_document_id;
end;
$$;

-- ── Додати проводку ─────────────────────────────────────────────────────────

-- Валюта й кількість — необов'язкові виміри проводки, що вмикаються ознаками
-- рахунку (is_currency / is_quantitative), як і субконто. Правило те саме, що
-- для субконто: якщо бодай один бік кореспонденції веде вимір, він обов'язковий;
-- де не веде — ядро обнуляє, щоб у регістр не потрапляв «валютний» мотлох.
--
-- Кількість задається ДВОМА способами, і різниця між ними — це різниця між
-- звичайною проводкою і складною:
--
--   • `p_quantity` — одне число на обидва кількісні боки. Надходження,
--     списання, переміщення: кількість там і справді одна. Правило строге, як
--     було: бодай один бік кількісний → параметр обов'язковий;
--   • `p_quantities` — jsonb `{"debit": 2, "credit": 6}`, кількість кожного
--     боку окремо. Це шлях складної проводки: комплектація списує 6 корпусів і
--     оприбутковує 2 комплекти одним рядком, а кількість головного боку
--     пишеться на ОДНОМУ з рядків операції — `{"credit": 2}` на другому рядку
--     означає «дебету кількості немає, і це свідомо».
--
-- Чому саме jsonb, а не пара numeric-параметрів: у PL/pgSQL «не передали» і
-- «передали null» нерозрізненні, а тут ця різниця і є захистом. Перелічити боки
-- в об'єкті — значить ВИСЛОВИТИ НАМІР, тож відсутній у переліку кількісний бік
-- лишається порожнім законно. Не передали об'єкта взагалі — діє строге правило
-- `p_quantity`, і забута кількість валить проведення, як і валила. Порожній
-- об'єкт `{}` теж законний: сума без кількості на кількісному рахунку — це
-- переоцінка, і доти вона не виражалася нічим.
--
-- Дзеркальний випадок — кількість без суми: `p_amount = 0` приймається, якщо
-- хоча б один кількісний бік дістав ненульову кількість. Це нестача при
-- списанні понад залишок (залишок іде в мінус кількістю, вартість виправляє
-- коригування). Нуль без кількості — помилка, як і був.
--
-- Валюта влаштована так само, лише значення боку — пара «валюта + сума»:
-- `p_currencies` = `{"debit": {"id": <currency_id>, "amount": <сума>}}`.
-- Конвертація «Дт 312 USD Кт 314 EUR» — два різні `id` у двох боках; доти вона
-- виражалася лише через рахунки «в дорозі». Legacy-пара `p_currency_id` +
-- `p_currency_amount` діє як діяла: одна валюта й сума на кожен валютний бік,
-- строго. Перелічений бік мусить бути повним — `id` без `amount` це помилка,
-- а не намір.
drop function if exists app.doc_entry_add(bigint, int, varchar, varchar, numeric, numeric, text, jsonb, jsonb);
drop function if exists app.doc_entry_add(bigint, int, varchar, varchar, numeric, numeric, text, jsonb, jsonb, bigint, numeric);
drop function if exists app.doc_entry_add(bigint, int, varchar, varchar, numeric, numeric, text, jsonb, jsonb, bigint, numeric, jsonb);
drop function if exists app.doc_entry_add(bigint, int, varchar, varchar, numeric, numeric, text, jsonb, jsonb, bigint, numeric, jsonb, jsonb);
create function app.doc_entry_add(
  p_document_id      bigint,
  p_line_no          int,
  p_debit_account    varchar,
  p_credit_account   varchar,
  p_amount           numeric,
  p_quantity         numeric default null,
  p_description      text    default null,
  p_debit_analytics  jsonb   default '{}'::jsonb,
  p_credit_analytics jsonb   default '{}'::jsonb,
  p_currency_id      bigint  default null,
  p_currency_amount  numeric default null,
  p_quantities       jsonb   default null,
  p_currencies       jsonb   default null
) returns bigint
language plpgsql
as $$
declare
  v_entry_id bigint;
  -- Ознаки рахунків — скалярами, а не record'ами: бік проводки може бути
  -- порожнім, і тоді `select … into` для нього не виконується взагалі, а
  -- звернення до неприсвоєного record'а в PL/pgSQL — це помилка виконання
  -- («record is not assigned yet»), а не null.
  v_is_group        boolean;
  v_debit_currency  boolean := false;
  v_debit_quantity  boolean := false;
  v_debit_off       boolean := false;
  v_credit_currency boolean := false;
  v_credit_quantity boolean := false;
  v_credit_off      boolean := false;
  v_needs_currency  boolean;
  v_needs_quantity  boolean;
  v_currency_id_debit      bigint;
  v_currency_amount_debit  numeric;
  v_currency_id_credit     bigint;
  v_currency_amount_credit numeric;
  v_quantity_debit         numeric;
  v_quantity_credit        numeric;
begin
  -- Суми немає зовсім — це недописаний рядок за будь-яких інших параметрів.
  -- Нульова сума — інша річ, і перевіряється нижче, коли вже відома кількість.
  if p_amount is null then
    raise exception '@[core.entryZeroAmount]%', jsonb_build_object('line', p_line_no, 'document', p_document_id)::text;
  end if;

  -- Два способи задати той самий вимір в одному виклику — це не вибір, а
  -- суперечність: котрий із них мав на увазі документ, звідси не видно, і
  -- мовчазна перевага одного ховала б помилку в його SQL.
  if p_quantities is not null and p_quantity is not null then
    raise exception 'doc_entry_add: передано і p_quantity, і p_quantities — залиш один спосіб';
  end if;
  if p_currencies is not null and (p_currency_id is not null or p_currency_amount is not null) then
    raise exception 'doc_entry_add: передано і p_currency_id/p_currency_amount, і p_currencies — залиш один спосіб';
  end if;

  -- Рівно один бік може бути порожнім: це забалансовий облік (див. коментар до
  -- таблиці). Жодного рахунку — не рух, а порожній рядок.
  if p_debit_account is null and p_credit_account is null then
    raise exception '@[core.entryNoAccount]%', jsonb_build_object('line', p_line_no)::text;
  end if;

  if p_debit_account is not null then
    select is_group, is_currency, is_quantitative, is_off_balance
      into v_is_group, v_debit_currency, v_debit_quantity, v_debit_off
    from app.chart_of_account where code = p_debit_account;
    if not found then
      raise exception '@[core.debitAccountNotFound]%', jsonb_build_object('account', p_debit_account)::text;
    elsif v_is_group then
      raise exception '@[core.debitAccountIsGroup]%', jsonb_build_object('account', p_debit_account)::text;
    end if;
  end if;

  if p_credit_account is not null then
    select is_group, is_currency, is_quantitative, is_off_balance
      into v_is_group, v_credit_currency, v_credit_quantity, v_credit_off
    from app.chart_of_account where code = p_credit_account;
    if not found then
      raise exception '@[core.creditAccountNotFound]%', jsonb_build_object('account', p_credit_account)::text;
    elsif v_is_group then
      raise exception '@[core.creditAccountIsGroup]%', jsonb_build_object('account', p_credit_account)::text;
    end if;
  end if;

  -- Однобічною проводка буває лише на забалансовому рахунку. Інакше порожній бік
  -- — це не задум, а недописаний рядок, і мовчки прийняти його не можна: у
  -- балансі він дасть розходження, яке шукатимуть у документах, а не тут.
  if (p_debit_account is null or p_credit_account is null)
     and not (v_debit_off or v_credit_off) then
    raise exception '@[core.entryOneSidedNotOffBalance]%',
      jsonb_build_object('line', p_line_no,
        'account', coalesce(p_debit_account, p_credit_account))::text;
  end if;

  v_needs_currency := v_debit_currency or v_credit_currency;
  v_needs_quantity := v_debit_quantity or v_credit_quantity;

  if p_currencies is not null then
    -- Перелічені боки — висловлений намір (див. коментар до функції). На
    -- відміну від кількості, значення боку тут ПАРА, і половина пари — не
    -- намір, а помилка: сума без валюти (чи навпаки) не означає нічого.
    -- `"debit": null` — ЦІЛА пара порожня, тобто «боку без валюти», як у
    -- кількості: намір висловлений, значення немає. Помилкою лишається саме
    -- ПОЛОВИНА пари — id без amount чи навпаки.
    if jsonb_typeof(p_currencies->'debit') = 'object' and v_debit_currency then
      v_currency_id_debit     := (p_currencies->'debit'->>'id')::bigint;
      v_currency_amount_debit := (p_currencies->'debit'->>'amount')::numeric;
      if v_currency_id_debit is null or v_currency_amount_debit is null then
        raise exception '@[core.entryNeedsCurrency]%', jsonb_build_object('line', p_line_no)::text;
      end if;
    end if;
    if jsonb_typeof(p_currencies->'credit') = 'object' and v_credit_currency then
      v_currency_id_credit     := (p_currencies->'credit'->>'id')::bigint;
      v_currency_amount_credit := (p_currencies->'credit'->>'amount')::numeric;
      if v_currency_id_credit is null or v_currency_amount_credit is null then
        raise exception '@[core.entryNeedsCurrency]%', jsonb_build_object('line', p_line_no)::text;
      end if;
    end if;
  elsif v_needs_currency then
    if p_currency_id is null or p_currency_amount is null then
      raise exception '@[core.entryNeedsCurrency]%', jsonb_build_object('line', p_line_no)::text;
    end if;
    v_currency_id_debit      := case when v_debit_currency  then p_currency_id end;
    v_currency_amount_debit  := case when v_debit_currency  then p_currency_amount end;
    v_currency_id_credit     := case when v_credit_currency then p_currency_id end;
    v_currency_amount_credit := case when v_credit_currency then p_currency_amount end;
  end if;  -- інакше лишаються null

  if p_quantities is not null then
    -- Перелічені боки — висловлений намір: кількісний бік, відсутній у
    -- переліку, лишається порожнім законно (голова складної проводки на
    -- іншому рядку; переоцінка). Некількісний бік обнуляється, як і решта
    -- мотлоху.
    v_quantity_debit  := case when v_debit_quantity  then (p_quantities->>'debit')::numeric end;
    v_quantity_credit := case when v_credit_quantity then (p_quantities->>'credit')::numeric end;
  elsif v_needs_quantity then
    if p_quantity is null then
      raise exception '@[core.entryNeedsQuantity]%', jsonb_build_object('line', p_line_no)::text;
    end if;
    v_quantity_debit  := case when v_debit_quantity  then p_quantity end;
    v_quantity_credit := case when v_credit_quantity then p_quantity end;
  end if;

  -- Нуль перевіряється ПІСЛЯ округлення до копійок: колонка numeric(18,2)
  -- округлює мовчки, тож 0.004 проходило б перевірку «не нуль» і лягало в
  -- регістр нулем.
  --
  -- Нульова сума законна рівно в одному випадку: у проводці є КІЛЬКІСТЬ —
  -- хоча б один кількісний бік дістав ненульове значення (теж після
  -- округлення колонки, до трьох знаків). Це рух кількості, вартість якого ще
  -- не визначена: списання понад залишок пише нестачу кількістю без суми, а
  -- вартість потім виправляє коригування. Перевіряється саме ЗАПИСАНА
  -- кількість, а не параметри: некількісний бік ядро обнуляє вище, тож
  -- кількість на рахунку, що її не веде, нуль не виправдовує. Без кількості
  -- нульова сума лишається помилкою, як і була, — такий рядок не рухає нічого;
  -- `{}` у `p_quantities` (переоцінка) разом із нулем теж.
  --
  -- Від'ємна сума НЕ відсікається навмисно: це сторно — коригування пишеться
  -- від'ємним числом на ТІЙ САМІЙ кореспонденції, а не перевернутою парою,
  -- інакше обороти обох рахунків роздуваються фіктивним рухом туди-назад.
  if round(p_amount, 2) = 0
     and coalesce(round(v_quantity_debit, 3), 0) = 0
     and coalesce(round(v_quantity_credit, 3), 0) = 0 then
    raise exception '@[core.entryZeroAmount]%', jsonb_build_object('line', p_line_no, 'document', p_document_id)::text;
  end if;

  insert into app.journal_entry (
    document_id, line_no, debit_account, credit_account, amount,
    currency_id_debit, currency_amount_debit, currency_id_credit, currency_amount_credit,
    quantity_debit, quantity_credit, description
  )
  values (
    p_document_id, p_line_no, p_debit_account, p_credit_account, p_amount,
    v_currency_id_debit, v_currency_amount_debit, v_currency_id_credit, v_currency_amount_credit,
    v_quantity_debit, v_quantity_credit, p_description
  )
  returning id into v_entry_id;

  -- Порожній бік аналітики не має за визначенням: субконто веде РАХУНОК, а його
  -- тут немає.
  if p_debit_account is not null then
    perform app.doc_analytic_set(v_entry_id, 'debit', p_debit_account, p_debit_analytics);
  end if;
  if p_credit_account is not null then
    perform app.doc_analytic_set(v_entry_id, 'credit', p_credit_account, p_credit_analytics);
  end if;

  return v_entry_id;
end;
$$;

-- ── Завершення проведення ───────────────────────────────────────────────────

drop function if exists app.doc_post_finish(bigint, bigint);
create function app.doc_post_finish(
  p_user_id     bigint,
  p_document_id bigint
) returns void
language sql
as $$
  update app.document
  set is_posted = true,
      posted_at = now(),
      posted_by = p_user_id,
      updated_at = now(),
      updated_by = p_user_id
  where id = p_document_id;
$$;

-- ── Скасування проведення ───────────────────────────────────────────────────

drop function if exists app.doc_unpost(bigint, bigint);
create function app.doc_unpost(
  p_user_id     bigint,
  p_document_id bigint
) returns void
language sql
as $$
  with cleared as (
    delete from app.journal_entry where document_id = p_document_id returning 1
  )
  update app.document
  set is_posted = false,
      posted_at = null,
      posted_by = null,
      updated_at = now(),
      updated_by = p_user_id
  where id = p_document_id;
$$;

-- ── Опис виміру мусить збігатися з таблицею, яку він описує ─────────────────
--
-- `app.doc_analytic_set` збирає запит за субконто ДИНАМІЧНО — з `target_table`,
-- `id_column`, `code_column`, `name_column`. Тому неіснуюча колонка в описі не
-- видно ані при публікації схеми, ані при записі документа: воно падає аж при
-- проведенні, і лише для тих рахунків, які ведуть саме цей вимір:
--   ERROR: column "code" does not exist
--   CONTEXT: PL/pgSQL function app.doc_analytic_set(...)
--
-- Тобто помилка в ОДНОМУ рядку конфігурації виявлялася через три кроки після
-- себе і виглядала як зламане проведення. Тригер повертає її на місце: рядок,
-- який описує довідник неправильно, просто не записується.
--
-- Тригером, а не перевіркою в сіді: писати сюди може й застосунок (уточнити
-- опис власного довідника — його право), а домовленість «не забудь покликати
-- перевірку» тримається рівно доти, доки про неї пам'ятають.

drop function if exists app.analytic_dimension_check() cascade;
create function app.analytic_dimension_check()
returns trigger
language plpgsql
as $$
declare
  v_rel     oid;
  v_missing text[] := '{}';
  v_column  text;
begin
  v_rel := to_regclass(new.target_table);

  if v_rel is null then
    raise exception 'Вимір «%»: таблиці % не існує', new.code, new.target_table
      using hint = 'target_table пишеться зі схемою: app.<таблиця>';
  end if;

  foreach v_column in array
    array_remove(array[new.id_column, new.code_column, new.name_column], null)
  loop
    if not exists (
      select 1 from pg_attribute
      where attrelid = v_rel and attname = v_column and attnum > 0 and not attisdropped
    ) then
      v_missing := v_missing || v_column;
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'Вимір «%»: у таблиці % немає колонок: %',
      new.code, new.target_table, array_to_string(v_missing, ', ')
      using hint = 'Субконто читається саме цими колонками — див. app.doc_analytic_set';
  end if;

  return new;
end;
$$;

drop trigger if exists tr_analytic_dimension_check on app.analytic_dimension;
create trigger tr_analytic_dimension_check
before insert or update on app.analytic_dimension
for each row execute function app.analytic_dimension_check();

-- ── Гак «перед записом документа» ───────────────────────────────────────────
--
-- Заборона закритого періоду, право писати заднім числом, будь-яка перевірка
-- «чи можна чіпати цей документ» потрібні КОЖНОМУ обліковому застосунку — і в
-- кожного мусили б діяти на ВСІХ шляхах запису шапки: `save` будь-якого
-- документа, `post`/`unpost`, позначка на видалення, і на кожній моделі, що
-- з'явиться потім. Дописувати перевірку в кожну команду означає «діє там, де не
-- забули»; ставити свій тригер на app.document — додавати об'єкт до ЧУЖОЇ
-- таблиці, про який ядро не знає й з яким розійдеться при першій же зміні
-- документообігу.
--
-- Тому точка розширення тут, і тригером — з тієї самої причини, що й у
-- `analytic_dimension_check` вище: домовленість «не забудь покликати перевірку»
-- тримається рівно доти, доки про неї пам'ятають.
--
-- Застосунок вмикає гак тим, що СТВОРЮЄ функцію:
--
--   create function app.doc_before_write(
--     p_user_id bigint, p_op text, p_doc jsonb, p_prev jsonb
--   ) returns void language plpgsql as $$
--   begin
--     if p_op in ('insert', 'update', 'post', 'unpost')
--        and (p_doc->>'doc_date')::date <= app.period_lock_date(p_user_id) then
--       raise exception 'Період закрито: %', p_doc->>'doc_date';
--     end if;
--   end $$;
--
-- Текст відмови їде людині, тож у застосунку його називають ключем-маркером
-- (див. docs/localization.md), а не пишуть рядком, як у прикладі вище: маркер
-- у ЦЬОМУ файлі проба звіряла б зі словниками фреймворку, а ключ там прикладний.
--
-- Немає функції — немає й перевірки; ядро мовчить. А от функція з ІНШИМ
-- підписом валить запис із текстом, який називає очікуваний: інакше застосунок
-- вважав би, що заборона діє, а вона мовчки не кликалася б — саме той різновид
-- помилки, заради якого гак і робиться.
--
-- `op` називає дію словом застосунку, а не SQL: 'insert', 'update', 'post',
-- 'unpost', 'delete' (позначка), 'undelete', 'purge' (фізичне видалення рядка).
-- Різницю доводиться називати ядру, бо з `TG_OP` вона не видно: і проведення, і
-- позначка на видалення — це `update`.
--
-- Рядки їдуть JSONB, а не одним `document_id`: на вставці читати ще нема чого
-- (рядка в таблиці немає), а перевірці потрібні саме реквізити — дата й
-- організація. `p_prev` дає стан ДО запису, тож перенесення документа з
-- відкритого періоду в закритий (і назад) теж видно.
--
-- Гак — сторож, а не редактор: значення, які він поверне, нікуди не йдуть, і
-- рядок записується таким, яким прийшов.

drop function if exists app.document_guard() cascade;
create function app.document_guard()
returns trigger
language plpgsql
as $$
declare
  v_hook regprocedure;
  v_op   text;
  v_user bigint;
begin
  v_hook := to_regprocedure('app.doc_before_write(bigint, text, jsonb, jsonb)');

  if v_hook is null then
    -- Функція з таким іменем є, але підпис інший — мовчати не можна: застосунок
    -- у цьому випадку впевнений, що заборона діє.
    if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'doc_before_write'
    ) then
      raise exception 'app.doc_before_write існує з іншим підписом і тому не кликається'
        using hint = 'Очікую app.doc_before_write(p_user_id bigint, p_op text, p_doc jsonb, p_prev jsonb) returns void';
    end if;
    return coalesce(new, old);
  end if;

  v_op := case
    when tg_op = 'INSERT' then 'insert'
    when tg_op = 'DELETE' then 'purge'
    when not old.is_posted  and new.is_posted  then 'post'
    when old.is_posted      and not new.is_posted then 'unpost'
    when not old.is_deleted and new.is_deleted then 'delete'
    when old.is_deleted     and not new.is_deleted then 'undelete'
    else 'update'
  end;

  -- Виконавця несе сам рядок: його пишуть усі шляхи запису (генерований `save`,
  -- `doc_unpost`, проведення). Окремого сеансового налаштування ядро не заводить —
  -- воно розійшлося б із рядком рівно тоді, коли писали б повз команду.
  v_user := coalesce(
    case when tg_op = 'DELETE' then old.updated_by else new.updated_by end,
    case when tg_op = 'DELETE' then old.created_by else new.created_by end
  );

  execute 'select app.doc_before_write($1, $2, $3, $4)'
    using v_user,
          v_op,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end,
          case when tg_op = 'INSERT' then null else to_jsonb(old) end;

  return coalesce(new, old);
end;
$$;

drop trigger if exists tr_document_guard on app.document;
create trigger tr_document_guard
before insert or update or delete on app.document
for each row execute function app.document_guard();

-- ── Пов'язані документи ─────────────────────────────────────────────────────
--
-- Дерево «хто на кого посилається» навколо документа — команда `related`
-- кожного документа (рантайм веде її сюди сам, як `post` у `<model>_post`).
-- Ребра — `app.document_link`: склад дає застосунок, генерується зі схем
-- (див. struc.sql і docs/related-documents-plan.md).
--
-- Три кроки, і в кожного своя причина форми:
--
-- 1. КОМПОНЕНТА — пошарово, в обидва боки, аж до межі вузлів. Пошарово, а не
--    рекурсивним CTE: CTE з `union` не бачить уже відвіданих вузлів іншої
--    глибини, тож цикл «A → B → A» крутився б до межі глибини, а тут
--    відвідане — масив, і вузол заходить рівно раз. Обидва відбори по
--    представленню йдуть умовою `= any(масив)`, яка проштовхується в кожну
--    гілку `union all` і бере її індекс. Межа ріже ДАЛЬНІЙ шар (ближні вузли
--    лишаються), і вихід за неї віддається прапорцем, а не мовчки.
--
-- 2. ДЕРЕВО — від коренів униз, як у 1С. Батько — той, НА КОГО посилаються:
--    податкова накладна посилається на відвантаження, тож під ним і стоїть.
--    Корінь — вузол, що ні на що в компоненті не посилається. Вузол із двома
--    батьками з'являється під кожним, але розкривається один раз, решта —
--    рядок-повтор: інакше спільна гілка множилася б під кожним батьком. Вузли,
--    до яких від коренів не дійти (компонента з самого циклу), стають деревом
--    самі — першим поточний документ.
--
-- 3. ПРАВА — по вузлу, `view` моделі самого вузла. Недоступний вузол лишається
--    в дереві з видом документа, але без id, номера, суми й подання: сховати
--    його цілком означало б збрехати про те, скільки кроків між документами.
--    Обхід крізь нього не спиняється — за ним можуть стояти документи, які
--    користувач бачить за власним правом.
--
-- Payload: `{ id, limit? }`; `limit` — межа вузлів, умовчання 200, стеля 1000.
drop function if exists app.document_related(bigint, jsonb);
create function app.document_related(p_user_id bigint, p_payload jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_raw_id    text := nullif(trim(coalesce(p_payload->>'id', '')), '');
  v_raw_limit text := nullif(trim(coalesce(p_payload->>'limit', '')), '');
  v_id        bigint;
  v_limit     int := 200;
  v_nodes     bigint[];
  v_frontier  bigint[];
  v_next      bigint[];
  v_truncated boolean := false;

  -- Ребра всередині компоненти, впорядковані за дитиною СПАДАННЯМ: стек
  -- розвертає порядок, тож діти виходять за датою зростанням.
  v_e_from  bigint[];
  v_e_to    bigint[];
  v_e_model text[];
  v_e_field text[];

  -- Стек обходу.
  v_s_id     bigint[] := '{}';
  v_s_parent int[]    := '{}';
  v_s_depth  int[]    := '{}';
  v_s_model  text[]   := '{}';
  v_s_field  text[]   := '{}';
  v_n        int;

  -- Вихід: рядок на кожну появу вузла.
  v_o_key    int[]     := '{}';
  v_o_parent int[]     := '{}';
  v_o_depth  int[]     := '{}';
  v_o_id     bigint[]  := '{}';
  v_o_model  text[]    := '{}';
  v_o_field  text[]    := '{}';
  v_o_repeat boolean[] := '{}';

  v_expanded  bigint[] := '{}';
  v_start     bigint[];
  v_cur       bigint;
  v_cur_key   int;
  v_cur_depth int;
  v_seq       int := 0;
  v_rows      jsonb;
begin
  -- Нечислове id — той самий «не знайдено», а не помилка приведення типу:
  -- команду кличе й агент, і відмова мусить бути конвертом.
  -- Дві перевірки, а не одна з `or`: порядок обчислення `or` PostgreSQL не
  -- обіцяє, і приведення могло б випередити перевірку формату.
  if v_raw_id ~ '^\d{1,18}$' then
    v_id := v_raw_id::bigint;
  end if;
  if v_id is null or not exists (select 1 from app.document where id = v_id) then
    return jsonb_build_object(
      'ok', false,
      'data', app.access_empty_data(),
      'messages', jsonb_build_array(
        '@[core.documentNotFound]' || jsonb_build_object('id', coalesce(v_raw_id, ''))::text
      )
    );
  end if;

  if v_raw_limit ~ '^\d{1,6}$' then
    v_limit := least(greatest(v_raw_limit::int, 1), 1000);
  end if;

  -- 1. Компонента.
  v_nodes := array[v_id];
  v_frontier := array[v_id];
  loop
    select coalesce(array_agg(s.n order by s.n), '{}')
      into v_next
      from (
        select l.to_id as n from app.document_link l where l.from_id = any(v_frontier)
        union
        select l.from_id from app.document_link l where l.to_id = any(v_frontier)
      ) s
     where s.n <> all(v_nodes)
       -- Посилання без FK може пережити документ; вузла, якого немає, у дереві
       -- бути не може.
       and exists (select 1 from app.document d where d.id = s.n);

    exit when cardinality(v_next) = 0;

    if cardinality(v_nodes) + cardinality(v_next) > v_limit then
      v_next := v_next[1 : v_limit - cardinality(v_nodes)];
      v_truncated := true;
    end if;

    v_nodes := v_nodes || v_next;
    v_frontier := v_next;
    exit when v_truncated;
  end loop;

  -- 2. Ребра компоненти. Два поля одного документа на той самий документ —
  -- одне ребро: у дереві це один зв'язок, а не два рядки.
  select coalesce(array_agg(e.from_id order by d.doc_date desc, d.id desc), '{}'),
         coalesce(array_agg(e.to_id   order by d.doc_date desc, d.id desc), '{}'),
         coalesce(array_agg(e.model   order by d.doc_date desc, d.id desc), '{}'),
         coalesce(array_agg(e.field   order by d.doc_date desc, d.id desc), '{}')
    into v_e_from, v_e_to, v_e_model, v_e_field
    from (
      select distinct on (l.from_id, l.to_id) l.from_id, l.to_id, l.model, l.field
        from app.document_link l
       where l.from_id = any(v_nodes)
         and l.to_id = any(v_nodes)
         and l.from_id <> l.to_id
       order by l.from_id, l.to_id, l.field
    ) e
    join app.document d on d.id = e.from_id;

  -- Корені — у зворотному порядку, бо їх теж кладуть на стек.
  select coalesce(array_agg(d.id order by d.doc_date desc, d.id desc), '{}')
    into v_start
    from app.document d
   where d.id = any(v_nodes)
     and d.id <> all(v_e_from);

  loop
    for i in 1 .. cardinality(v_start) loop
      v_s_id     := v_s_id || v_start[i];
      v_s_parent := v_s_parent || null::int;
      v_s_depth  := v_s_depth || 0;
      v_s_model  := v_s_model || null::text;
      v_s_field  := v_s_field || null::text;
    end loop;

    while cardinality(v_s_id) > 0 loop
      v_n := cardinality(v_s_id);
      v_cur := v_s_id[v_n];
      v_cur_depth := v_s_depth[v_n];
      v_seq := v_seq + 1;
      v_cur_key := v_seq;

      v_o_key    := v_o_key || v_cur_key;
      v_o_parent := v_o_parent || v_s_parent[v_n];
      v_o_depth  := v_o_depth || v_cur_depth;
      v_o_id     := v_o_id || v_cur;
      v_o_model  := v_o_model || v_s_model[v_n];
      v_o_field  := v_o_field || v_s_field[v_n];
      v_o_repeat := v_o_repeat || (v_cur = any(v_expanded));

      v_s_id     := v_s_id[1 : v_n - 1];
      v_s_parent := v_s_parent[1 : v_n - 1];
      v_s_depth  := v_s_depth[1 : v_n - 1];
      v_s_model  := v_s_model[1 : v_n - 1];
      v_s_field  := v_s_field[1 : v_n - 1];

      if v_cur <> all(v_expanded) then
        v_expanded := v_expanded || v_cur;
        for i in 1 .. cardinality(v_e_from) loop
          if v_e_to[i] = v_cur then
            v_s_id     := v_s_id || v_e_from[i];
            v_s_parent := v_s_parent || v_cur_key;
            v_s_depth  := v_s_depth || (v_cur_depth + 1);
            v_s_model  := v_s_model || v_e_model[i];
            v_s_field  := v_s_field || v_e_field[i];
          end if;
        end loop;
      end if;
    end loop;

    -- Нерозкрите лишається тільки в компоненти з самого циклу: коренів у неї
    -- немає. Першим — поточний документ, далі найраніший.
    if v_id <> all(v_expanded) then
      v_start := array[v_id];
    else
      select coalesce(array_agg(x.id), '{}')
        into v_start
        from (
          select d.id
            from app.document d
           where d.id = any(v_nodes) and d.id <> all(v_expanded)
           order by d.doc_date, d.id
           limit 1
        ) x;
    end if;

    exit when cardinality(v_start) = 0;
  end loop;

  -- 3. Реквізити й права. Право рахується раз на тип, а не на рядок.
  with o as (
    select *
      from unnest(v_o_key, v_o_parent, v_o_depth, v_o_id, v_o_model, v_o_field, v_o_repeat)
        as o(key, parent_key, depth, id, via_model, via_field, is_repeat)
  ),
  types as (
    select dt.id, dt.code, coalesce(nullif(dt.short_name, ''), dt.name) as name,
           app.access_can(p_user_id, dt.code, 'view') as can
      from app.document_type dt
     where dt.id in (select d.document_type_id from app.document d where d.id = any(v_nodes))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key',          o.key,
           'parentKey',    o.parent_key,
           'depth',        o.depth,
           'isCurrent',    o.id = v_id,
           'isRepeat',     o.is_repeat,
           'isAvailable',  t.can,
           'typeCode',     t.code,
           'typeName',     t.name,
           'id',           case when t.can then o.id::text end,
           'number',       case when t.can then d.number end,
           'docDate',      case when t.can then d.doc_date end,
           'total',        case when t.can then d.total end,
           'presentation', case when t.can then d.presentation end,
           'isPosted',     case when t.can then d.is_posted end,
           'isDeleted',    case when t.can then d.is_deleted end,
           'viaModel',     o.via_model,
           'viaField',     o.via_field
         ) order by o.key), '[]'::jsonb)
    into v_rows
    from o
    join app.document d on d.id = o.id
    join types t on t.id = d.document_type_id;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', jsonb_build_object(
        'id', v_id::text,
        'nodes', cardinality(v_nodes),
        'limit', v_limit,
        'truncated', v_truncated
      ),
      'rows', v_rows,
      'options', '{}'::jsonb,
      'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
end;
$$;

-- ── Проба ребер: індекси й покриття ─────────────────────────────────────────
--
-- Дві речі, яких не видно ні на генерації, ні на публікації, ні на демо-наборі:
--
-- `no_index` — колонка ребра без індексу, що з неї починається. Обхід
--   `app.document_related` відбирає по представленню умовою `= any(масив)` в
--   обидва боки, і без індексу кожна гілка — повний перегляд таблиці. На
--   сотні документів різниці немає; вона з'являється в застосунку, що
--   відпрацював рік (та сама пастка, що в docs/ledger-performance.md).
--   Перевіряються обидві колонки: посилання (хто посилається на мене) і
--   власник (на кого посилаюся я) — у шапки власник це первинний ключ, а в
--   рядка табличної частини — `parentFk`, на якому індексу може й не бути.
--
-- `uncovered_fk` — FK таблиці документа на документ, який ребром не став і не
--   оголошений відмовою. Найчастіша причина — посилання в схемі голим `bigint`
--   без `x-ref`: база зв'язок знає, генератор — ні, і дерево мовчки неповне.
--   Таблиця документа — шапка (первинний ключ `document_id` і FK на
--   `app.document`) або її рядки (FK на шапку з `on delete cascade`). Регістри
--   сюди не потрапляють: їхній реєстратор — рух документа, а не зв'язок.
--
-- Кличе її публікація (`publishAppSql`) і друкує знайдене попередженням:
-- валити розгортання через індекс не можна, а мовчати — означає не знайти ніколи.
drop function if exists app.document_link_check();
create function app.document_link_check()
returns table (kind text, table_name text, column_name text, model text, field text)
language sql
stable
as $$
  with src as (
    select s.model, s.field, s.table_schema, s.table_name, c.col, s.is_related
      from app.document_link_source s
      cross join lateral (values (s.owner_column), (s.ref_column)) c(col)
  ),
  src_att as (
    select src.*, cls.oid as relid, a.attnum
      from src
      join pg_namespace n on n.nspname = src.table_schema
      join pg_class cls on cls.relnamespace = n.oid and cls.relname = src.table_name
      join pg_attribute a on a.attrelid = cls.oid and a.attname = src.col and not a.attisdropped
  ),
  unindexed as (
    select 'no_index'::text as kind,
           sa.table_schema || '.' || sa.table_name as table_name,
           sa.col as column_name,
           min(sa.model) as model,
           min(sa.field) as field
      from src_att sa
     where sa.is_related
       and not exists (
         select 1 from pg_index i where i.indrelid = sa.relid and i.indkey[0] = sa.attnum
       )
     group by sa.table_schema, sa.table_name, sa.col
  ),
  headers as (
    select con.conrelid as relid
      from pg_constraint con
     where con.contype = 'f'
       and con.confrelid = 'app.document'::regclass
       and cardinality(con.conkey) = 1
       and exists (
         select 1 from pg_constraint pk
          where pk.conrelid = con.conrelid and pk.contype = 'p' and pk.conkey = con.conkey
       )
  ),
  line_tables as (
    select distinct con.conrelid as relid, con.oid as owner_fk
      from pg_constraint con
     where con.contype = 'f'
       and con.confrelid in (select relid from headers)
       and con.confdeltype = 'c'
       and con.conrelid not in (select relid from headers)
  ),
  uncovered as (
    select 'uncovered_fk'::text as kind,
           n.nspname || '.' || cls.relname as table_name,
           a.attname::text as column_name,
           null::text as model,
           null::text as field
      from pg_constraint con
      join pg_class cls on cls.oid = con.conrelid
      join pg_namespace n on n.oid = cls.relnamespace
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.contype = 'f'
       and cardinality(con.conkey) = 1
       and (con.confrelid = 'app.document'::regclass or con.confrelid in (select relid from headers))
       and (con.conrelid in (select relid from headers) or con.conrelid in (select relid from line_tables))
       -- Власний зв'язок таблиці: шапка → app.document первинним ключем,
       -- рядок → шапка.
       and not exists (
         select 1 from pg_constraint pk
          where pk.conrelid = con.conrelid and pk.contype = 'p' and pk.conkey = con.conkey
       )
       and con.oid not in (select owner_fk from line_tables)
       and not exists (
         select 1 from src_att sa
          where sa.relid = con.conrelid and sa.attnum = con.conkey[1]
       )
  )
  select * from unindexed
  union all
  select * from uncovered
  order by 1, 2, 3;
$$;
