-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.
-- Джерело: document_movements.schema.ts (DocumentMovementsFiltersSchema) + manifest.json.
-- Сам запит звіту — рукописний, у db/document_movements.sql: app.document_movements_data(user_id, filters).

drop function if exists app.document_movements_index(bigint, jsonb);
create function app.document_movements_index(user_id bigint, payload jsonb)
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
    'documentId', nullif(v_filters->>'documentId', '')
  ));

  -- Назад ссылка їде з підписом із бази: id міг прийти сам, без назви (перехід
  -- із іншого звіту), і тоді пікер стояв би порожнім при діючому фільтрі.
  v_out := v_filters;

  if not (v_norm ? 'documentId') then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object(
        'item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb,
        'totals', '{}'::jsonb, 'extra', '{}'::jsonb, '$filters', v_out
      ),
      'messages', jsonb_build_array(jsonb_build_object(
        'type', 'error',
        'text', '@[core.reportFilterRequired]',
        'field', 'documentId'
      )),
      'meta', '{}'::jsonb
    );
  end if;

  v_data := coalesce(app.document_movements_data(user_id, v_norm), '{}'::jsonb);

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
