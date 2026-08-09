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
    if v_line.debit_account is null or v_line.credit_account is null then
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
