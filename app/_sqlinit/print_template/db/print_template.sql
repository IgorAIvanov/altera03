-- Ядро підсистеми друку: підбір активного шаблону для моделі.
--
-- Єдина SQL-функція, потрібна рантайму друку. Її викликає хендлер
-- runtime.printPdf (server/modules/print). CRUD шаблонів живе в
-- admin-моделі app/admin/print_template.

-- Підбір активного шаблону для моделі: явно вказаний код, інакше — шаблон за
-- замовчуванням, інакше — найсвіжіший активний. Викликає TS-команда printPdf.
drop function if exists app.print_template_resolve(bigint, jsonb);
create function app.print_template_resolve(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', (
        select jsonb_build_object(
          'id',          t.id::text,
          'code',        t.code,
          'name',        t.name,
          'targetModel', t.target_model,
          'dataCommand', t.data_command,
          'paperSize',   t.paper_size,
          'orientation', t.orientation,
          'isDefault',   t.is_default,
          'isActive',    t.is_active,
          'schema',      t.template_schema
        )
        from app.print_template t
        where t.target_model = nullif(trim(coalesce(payload->>'targetModel', '')), '')
          and t.is_active
          and (
            nullif(trim(coalesce(payload->>'templateCode', '')), '') is null
            or t.code = nullif(trim(coalesce(payload->>'templateCode', '')), '')
          )
        order by t.is_default desc, t.updated_at desc, t.code asc
        limit 1
      ),
      'rows',    '[]'::jsonb,
      'options', '{}'::jsonb,
      'totals',  '{}'::jsonb,
      'extra',   '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
$$;
