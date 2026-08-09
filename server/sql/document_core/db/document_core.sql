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
  select id, is_deleted into v_doc
  from app.document
  where id = p_document_id;

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
drop function if exists app.doc_entry_add(bigint, int, varchar, varchar, numeric, numeric, text, jsonb, jsonb);
drop function if exists app.doc_entry_add(bigint, int, varchar, varchar, numeric, numeric, text, jsonb, jsonb, bigint, numeric);
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
  p_currency_amount  numeric default null
) returns bigint
language plpgsql
as $$
declare
  v_entry_id bigint;
  v_debit    record;
  v_credit   record;
  v_needs_currency  boolean;
  v_needs_quantity  boolean;
  v_currency_id     bigint;
  v_currency_amount numeric;
  v_quantity        numeric;
begin
  if p_amount is null or p_amount = 0 then
    raise exception '@[core.entryZeroAmount]%', jsonb_build_object('line', p_line_no, 'document', p_document_id)::text;
  end if;

  select is_group, is_currency, is_quantitative into v_debit
  from app.chart_of_account where code = p_debit_account;
  if v_debit is null then
    raise exception '@[core.debitAccountNotFound]%', jsonb_build_object('account', p_debit_account)::text;
  elsif v_debit.is_group then
    raise exception '@[core.debitAccountIsGroup]%', jsonb_build_object('account', p_debit_account)::text;
  end if;

  select is_group, is_currency, is_quantitative into v_credit
  from app.chart_of_account where code = p_credit_account;
  if v_credit is null then
    raise exception '@[core.creditAccountNotFound]%', jsonb_build_object('account', p_credit_account)::text;
  elsif v_credit.is_group then
    raise exception '@[core.creditAccountIsGroup]%', jsonb_build_object('account', p_credit_account)::text;
  end if;

  v_needs_currency := v_debit.is_currency or v_credit.is_currency;
  v_needs_quantity := v_debit.is_quantitative or v_credit.is_quantitative;

  if v_needs_currency then
    if p_currency_id is null or p_currency_amount is null then
      raise exception '@[core.entryNeedsCurrency]%', jsonb_build_object('line', p_line_no)::text;
    end if;
    v_currency_id := p_currency_id;
    v_currency_amount := p_currency_amount;
  end if;  -- інакше лишаються null

  if v_needs_quantity then
    if p_quantity is null then
      raise exception '@[core.entryNeedsQuantity]%', jsonb_build_object('line', p_line_no)::text;
    end if;
    v_quantity := p_quantity;
  end if;

  insert into app.journal_entry (
    document_id, line_no, debit_account, credit_account, amount,
    currency_id, currency_amount, quantity, description
  )
  values (
    p_document_id, p_line_no, p_debit_account, p_credit_account, p_amount,
    v_currency_id, v_currency_amount, v_quantity, p_description
  )
  returning id into v_entry_id;

  perform app.doc_analytic_set(v_entry_id, 'debit',  p_debit_account,  p_debit_analytics);
  perform app.doc_analytic_set(v_entry_id, 'credit', p_credit_account, p_credit_analytics);

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
