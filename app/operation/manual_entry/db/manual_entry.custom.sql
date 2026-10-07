-- Нестандартні команди моделі manual_entry.

-- ── Денормалізація шапки ──────────────────────────────────────────────────────
-- Хук за іменем: викликається згенерованою app.manual_entry_save після запису
-- рядків. Сума операції = сума проводок.
drop function if exists app.manual_entry_denormalize(bigint, bigint);
create function app.manual_entry_denormalize(user_id bigint, document_id bigint)
returns void
language sql
as $$
  update app.document h
  set total = coalesce(lines.total, 0),
      presentation = concat_ws(' ',
        'Операція №' || coalesce(h.number, '?'),
        'від ' || to_char(h.doc_date, 'DD.MM.YYYY')
      )
  from (
    select round(coalesce(sum(l.amount), 0), 2) as total
    from app.manual_entry_line l
    where l.document_id = manual_entry_denormalize.document_id
  ) lines
  where h.id = manual_entry_denormalize.document_id;
$$;

-- ── Проведення ────────────────────────────────────────────────────────────────
-- Проводки ручної операції — це рядки, які ввів користувач, один в один.
-- Перевірки (рахунок існує, не група, обов'язкові субконто заповнені) робить
-- ядро в app.doc_entry_add, тому тут їх немає: одна перевірка в одному місці.
drop function if exists app.manual_entry_post_entries(bigint, bigint);
create function app.manual_entry_post_entries(user_id bigint, document_id bigint)
returns void
language plpgsql
as $$
declare
  v_line  record;
  v_count int := 0;
begin
  for v_line in
    select l.line_no, l.debit_account, l.credit_account, l.amount,
           l.currency_id, l.currency_amount, l.quantity,
           l.debit_analytics, l.credit_analytics, l.description
    from app.manual_entry_line l
    where l.document_id = manual_entry_post_entries.document_id
    order by l.line_no, l.id
  loop
    -- Порожній ОДИН бік — законна проводка забалансового рахунку, і ядро саме
    -- перевірить, що рахунок справді забалансовий. Тут лишається порожній
    -- рядок: у ньому немає нічого, що можна було б провести.
    if v_line.debit_account is null and v_line.credit_account is null then
      raise exception '@[manualEntry.lineNoAccount]%', jsonb_build_object('line', v_line.line_no)::text;
    end if;

    -- Валюту/кількість/обов'язковість субконто перевіряє doc_entry_add за
    -- ознаками рахунку — тут лише передаємо введене користувачем.
    perform app.doc_entry_add(
      manual_entry_post_entries.document_id,
      v_line.line_no,
      v_line.debit_account,
      v_line.credit_account,
      v_line.amount,
      v_line.quantity,
      v_line.description,
      coalesce(v_line.debit_analytics, '{}'::jsonb),
      coalesce(v_line.credit_analytics, '{}'::jsonb),
      v_line.currency_id,
      v_line.currency_amount
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception '@[manualEntry.postNoEntries]';
  end if;
end;
$$;

-- ── Заповнення на підставі ───────────────────────────────────────────────────
-- «Створити на підставі»: чернетка НОВОЇ операції з документа-підстави.
-- Перелік підстав — `basedOn` у манифесті; рантайм звіряє з ним `basisModel`
-- ДО виклику, тож незнайома модель сюди не доходить. Нічого не пише: запис
-- віддається у формі `get` (без id), зберігає його людина чи агент `save`.
--
-- Накладна → реалізація: Дт 361 (контрагент накладної) Кт 701 на суму
-- накладної. Посилання на підставу — `baseDocumentId`, і дерево пов'язаних
-- документів показує ланцюжок саме з нього.
drop function if exists app.manual_entry_fill_basis(bigint, jsonb);
create function app.manual_entry_fill_basis(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_basis_id bigint := nullif(payload->>'basisId', '')::bigint;
  v_item     jsonb;
begin
  if payload->>'basisModel' = 'invoice' then
    select jsonb_build_object(
      'organizationId', h.organization_id::text,
      'organization', case when o.id is null then null
                           else jsonb_build_object('id', o.id::text, 'name', o.name) end,
      'docDate', h.doc_date,
      'description', h.presentation,
      'baseDocumentId', h.id::text,
      'baseDocument', jsonb_build_object(
        'id', h.id::text,
        'presentation', coalesce(nullif(h.presentation, ''), h.number),
        'typeCode', 'invoice'),
      'entries', jsonb_build_array(jsonb_build_object(
        'id', null,
        'lineNo', 1,
        'debitAccount', '361',
        'debitAnalytics', jsonb_build_object(
          'counterparty', jsonb_build_object('id', c.id::text, 'name', c.name)),
        'creditAccount', '701',
        'creditAnalytics', '{}'::jsonb,
        'amount', h.total,
        'description', h.presentation))
    )
    into v_item
    from app.document h
    join app.invoice i on i.document_id = h.id
    join app.counterparty c on c.id = i.counterparty_id
    left join app.organization o on o.id = h.organization_id
    where h.id = v_basis_id
      and not h.is_deleted;
  end if;

  -- Позначену на видалення підставу не беремо: чернетка з документа, якого
  -- «немає», виглядала б звичайною.
  if v_item is null then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object('item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb,
                                 'totals', '{}'::jsonb, 'extra', '{}'::jsonb),
      'messages', jsonb_build_array('@[manualEntry.basisNotFound]'),
      'meta', '{}'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object('item', v_item, 'rows', '[]'::jsonb, 'options', '{}'::jsonb,
                               'totals', '{}'::jsonb, 'extra', '{}'::jsonb),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb);
end;
$$;
