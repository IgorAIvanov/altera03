-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.
-- Джерело: account_card.schema.ts (AccountCardFiltersSchema) + manifest.json.
-- Сам запит звіту — рукописний, у db/account_card.sql: app.account_card_data(user_id, filters).

drop function if exists app.account_card_index(bigint, jsonb);
create function app.account_card_index(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_filters jsonb := coalesce(payload->'filters', '{}'::jsonb);
  v_norm    jsonb;
  v_out     jsonb;
  v_data    jsonb;
begin
  -- Ссылка згортається до id: далі всередині звіту вона нікому не потрібна.
  v_norm := jsonb_strip_nulls(jsonb_build_object(
    'organizationId', nullif(v_filters->'organization'->>'id', ''),
    'accountCode', nullif(v_filters->>'accountCode', ''),
    'dateFrom', nullif(v_filters->>'dateFrom', ''),
    'dateTo', nullif(v_filters->>'dateTo', '')
  ));

  -- Назад ссылка їде з підписом із бази: id міг прийти сам, без назви (перехід
  -- із іншого звіту), і тоді пікер стояв би порожнім при діючому фільтрі.
  v_out := v_filters || jsonb_strip_nulls(jsonb_build_object(
    'organization',
    (select jsonb_build_object('id', x.id::text, 'name', x.name)
       from app.organization x where x.id = (v_norm->>'organizationId')::bigint)
  ));

  if not (v_norm ? 'organizationId') then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object(
        'item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb,
        'totals', '{}'::jsonb, 'extra', '{}'::jsonb, '$filters', v_out
      ),
      'messages', jsonb_build_array(jsonb_build_object(
        'type', 'error',
        'text', '@[core.reportFilterRequired]',
        'field', 'organization'
      )),
      'meta', '{}'::jsonb
    );
  end if;

  if not (v_norm ? 'accountCode') then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object(
        'item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb,
        'totals', '{}'::jsonb, 'extra', '{}'::jsonb, '$filters', v_out
      ),
      'messages', jsonb_build_array(jsonb_build_object(
        'type', 'error',
        'text', '@[core.reportFilterRequired]',
        'field', 'accountCode'
      )),
      'meta', '{}'::jsonb
    );
  end if;

  v_data := coalesce(app.account_card_data(user_id, v_norm), '{}'::jsonb);

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item',     v_data->'item',
      'rows',     coalesce(v_data->'rows', '[]'::jsonb),
      'options',  coalesce(v_data->'options', '{}'::jsonb),
      'totals',   coalesce(v_data->'totals', '{}'::jsonb),
      'extra',    coalesce(v_data->'extra', '{}'::jsonb),
      '$filters', v_out
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
end;
$$;
