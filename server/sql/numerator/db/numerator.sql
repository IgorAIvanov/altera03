-- ═══════════════════════════════════════════════════════════════════════════
-- Функції нумератора.
--
-- Точка входу одна — app.numerator_next(model, scope). Решта або обслуговує її,
-- або потрібна екрану налаштування та міграції наявних даних.
--
-- scope — це jsonb з фактами, відомими на момент запису:
--   {"orgId": 3, "date": "2026-08-09"}
-- Довідник передає порожній {} — у нього немає ні організації, ні дати.
--
-- РІК БЕРЕТЬСЯ З ДАТИ ДОКУМЕНТА, а не з now(): документ, уведений заднім числом
-- у грудень, мусить отримати торішній лічильник. Зворотний бік — зміна дати вже
-- записаного документа номер НЕ змінює (номер видається один раз).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Ключ періоду ────────────────────────────────────────────────────────────
-- Ділить лічильник на періоди. Береться з ДАТИ ДОКУМЕНТА — окремого стовпчика
-- з періодом ніде немає, бо дата вже є, а копія розходилася б із нею.
--
-- Порожній рядок — «періоду немає», лічильник наскрізний.

drop function if exists app.numerator_period_key(varchar, timestamp);
create function app.numerator_period_key(p_model varchar, p_date timestamp)
returns varchar
language plpgsql
stable
as $$
declare
  v_period varchar;
begin
  select n.period into v_period from app.numerator n where n.model = p_model;
  if v_period is null or v_period = 'none' then
    return '';
  end if;

  if p_date is null then
    -- Без дати період не визначити, а мовчки підставити now() не можна: код
    -- довідника, виданий у січні, потрапив би в інший період, ніж грудневий,
    -- і два записи дістали б однаковий код.
    raise exception 'Нумератор «%» веде період «%», але дати в області немає', p_model, v_period
      using hint = 'period працює для документів; довідник лишається на none';
  end if;

  return case v_period
    when 'year'  then to_char(p_date, 'YYYY')
    when 'month' then to_char(p_date, 'YYYY-MM')
  end;
end;
$$;

-- ── Область лічильника ──────────────────────────────────────────────────────
-- Організація (коли вона в області є) плюс ключ періоду. {TYPE} в область не
-- входить: у кожної моделі свій нумератор, тож тип уже враховано ключем.
--
-- З ШАБЛОНА область НЕ виводиться — той самий принцип, що й у period: шаблон
-- задає вигляд номера, а не облікове правило. Перша версія ділила лічильник по
-- організаціях лише коли {ORG} надруковано в номері — тобто прибрати префікс
-- із номера означало б МОВЧКИ злити лічильники всіх організацій. А розходження
-- тут типове, не екзотичне: кожна юрособа нумерує свої документи незалежно,
-- але префікс організації в номері друкують далеко не всі. Тому область
-- збирається з ФАКТІВ запису (організація відома — вона в ключі) і за
-- побудовою збігається зі складом uq_document_number, який теж включає
-- organization_id незалежно від того, що надруковано.

drop function if exists app.numerator_scope_key(varchar, jsonb);
drop function if exists app.numerator_scope_key(varchar, jsonb, boolean);
create function app.numerator_scope_key(p_model varchar, p_scope jsonb)
returns varchar
language plpgsql
stable
as $$
declare
  v_parts text[] := '{}';
  v_org   text   := nullif(p_scope->>'orgId', '');
begin
  if v_org is not null then
    v_parts := v_parts || v_org;
  end if;

  v_parts := v_parts || app.numerator_period_key(
    p_model,
    nullif(p_scope->>'date', '')::timestamp
  );

  return array_to_string(v_parts, '|');
end;
$$;

-- ── Підстановка шаблона ─────────────────────────────────────────────────────
-- Одне місце, де шаблон перетворюється на текст. Ним користуються і видача
-- номера, і розбір уже виданого: інакше регулярний вираз для розбору жив би
-- окремо від складання й розійшовся б із ним.

drop function if exists app.numerator_apply(varchar, text, jsonb, varchar);
create function app.numerator_apply(
  p_template varchar,
  p_digits   text,
  p_scope    jsonb,
  p_model    varchar
) returns text
language plpgsql
stable
as $$
declare
  v_date   timestamp := coalesce(nullif(p_scope->>'date', '')::timestamp, now());
  v_org    bigint    := nullif(p_scope->>'orgId', '')::bigint;
  v_out    text      := p_template;
  v_prefix text;
  v_ph     text;
begin
  if v_out ~ '\{ORG\}' then
    if v_org is null then
      raise exception 'Шаблон нумератора «%» містить {ORG}, але організацію не передано', p_model
        using hint = 'scope мусить нести orgId';
    end if;
    select coalesce(o.prefix, '') into v_prefix from app.organization o where o.id = v_org;
    v_out := replace(v_out, '{ORG}', coalesce(v_prefix, ''));
  end if;

  if v_out ~ '\{TYPE\}' then
    select coalesce(dt.prefix, '') into v_prefix from app.document_type dt where dt.code = p_model;
    v_out := replace(v_out, '{TYPE}', coalesce(v_prefix, ''));
  end if;

  -- {YYYY} строго перед {YY}: інакше від «{YYYY}» лишилося б «26YY».
  v_out := replace(v_out, '{YYYY}', to_char(v_date, 'YYYY'));
  v_out := replace(v_out, '{YY}',   to_char(v_date, 'YY'));
  v_out := replace(v_out, '{MM}',   to_char(v_date, 'MM'));

  v_ph := substring(v_out from '\{N+\}');
  if v_ph is null then
    raise exception 'Шаблон нумератора «%» не містить лічильника {N…}', p_template;
  end if;

  return replace(v_out, v_ph, p_digits);
end;
$$;

-- ── Готовий номер ───────────────────────────────────────────────────────────

drop function if exists app.numerator_render(varchar, bigint, jsonb, varchar);
create function app.numerator_render(
  p_template varchar,
  p_value    bigint,
  p_scope    jsonb,
  p_model    varchar
) returns varchar
language plpgsql
stable
as $$
declare
  v_ph     text := substring(p_template from '\{N+\}');
  v_width  int;
  v_digits text := p_value::text;
begin
  if v_ph is null then
    raise exception 'Шаблон нумератора «%» не містить лічильника {N…}', p_template;
  end if;

  v_width := length(v_ph) - 2;
  -- lpad ОБРІЗАЄ значення, довше за ширину, тому доповнюємо лише коли є куди:
  -- номер 1000000 у шаблоні {NNNNNN} мусить стати довшим, а не перетворитися
  -- на «000000» і зіткнутися з уже виданим.
  if length(v_digits) < v_width then
    v_digits := lpad(v_digits, v_width, '0');
  end if;

  return app.numerator_apply(p_template, v_digits, p_scope, p_model);
end;
$$;

-- ── Розбір виданого номера ──────────────────────────────────────────────────
-- Потрібен там, де номер прийшов ззовні: користувач виправив його руками або
-- він лежить у базі з часів, коли нумератора ще не було.

drop function if exists app.numerator_pattern(varchar, jsonb, varchar);
create function app.numerator_pattern(p_template varchar, p_scope jsonb, p_model varchar)
returns text
language plpgsql
stable
as $$
declare
  -- chr(1) як маркер лічильника: у номері його бути не може, і для регулярного
  -- виразу він не особливий, тож екранування його не зачепить.
  v_text text := app.numerator_apply(p_template, chr(1), p_scope, p_model);
begin
  v_text := regexp_replace(v_text, '([\.\^\$\*\+\?\(\)\[\]\{\}\|\\-])', '\\\1', 'g');
  return '^' || replace(v_text, chr(1), '([0-9]+)') || '$';
end;
$$;

drop function if exists app.numerator_parse(varchar, jsonb, varchar);
create function app.numerator_parse(p_model varchar, p_scope jsonb, p_number varchar)
returns bigint
language plpgsql
stable
as $$
declare
  v_template varchar;
  v_match    text[];
begin
  select n.template into v_template from app.numerator n where n.model = p_model;
  if v_template is null or p_number is null then
    return null;
  end if;

  v_match := regexp_match(p_number, app.numerator_pattern(v_template, p_scope, p_model));
  if v_match is null then
    return null;   -- номер набраний не за шаблоном — це не помилка
  end if;

  return v_match[1]::bigint;
end;
$$;

-- ── Послідовність для стратегії sequence ────────────────────────────────────
-- Одна на область, створюється при першій потребі. Ім'я — хеш, бо scope_key
-- містить довільні значення, а на ім'я об'єкта в PostgreSQL є 63 байти.
--
-- ПЕРЕМИКАННЯ СТРАТЕГІЇ ВИМАГАЄ ПЕРЕСІВУ. counter веде лічильник у
-- numerator_state, sequence — у послідовності, і одне про одне вони не знають:
-- при створенні послідовність засівається зі стану (нижче), а зворотного шляху
-- немає. Тому той, хто міняє strategy, мусить слідом викликати
-- app.numerator_seed_from_existing — вона читає ФАКТИЧНО видані номери й
-- підтягує ОБИДВА місця (стан і чинні послідовності), тож працює в обидва
-- боки перемикання; пропущені при відкатах значення не воскрешає.

-- Рецепт імені окремо: ним користуються і створення (нижче), і пересів
-- (numerator_seed_from_existing) — друга копія md5-рецепта розійшлася б мовчки,
-- і пересів підтягував би НЕ ту послідовність, з якої видаються номери.
drop function if exists app.numerator_sequence_name(varchar, varchar);
create function app.numerator_sequence_name(p_model varchar, p_scope_key varchar)
returns text
language sql
immutable
as $$
  select format('app.%I', 'numseq_' || md5(p_model || '|' || p_scope_key));
$$;

drop function if exists app.numerator_sequence(varchar, varchar);
create function app.numerator_sequence(p_model varchar, p_scope_key varchar)
returns text
language plpgsql
as $$
declare
  v_full text := app.numerator_sequence_name(p_model, p_scope_key);
  v_seed bigint;
begin
  if to_regclass(v_full) is null then
    begin
      execute format('create sequence %s', v_full);
      -- Перехід із counter на sequence і перші номери після міграції: почати
      -- не з одиниці, а з того, що вже видано.
      select s.last_value into v_seed
      from app.numerator_state s
      where s.model = p_model and s.scope_key = p_scope_key;
      if coalesce(v_seed, 0) > 0 then
        execute format('select setval(%L, %s)', v_full, v_seed);
      end if;
    exception when duplicate_table then
      null;   -- створив паралельний сеанс, поки ми були тут
    end;
  end if;

  return v_full;
end;
$$;

-- ── Видача номера ───────────────────────────────────────────────────────────

drop function if exists app.numerator_next(varchar, jsonb);
create function app.numerator_next(p_model varchar, p_scope jsonb)
returns varchar
language plpgsql
as $$
declare
  v_template varchar;
  v_strategy varchar;
  v_scope    varchar;
  v_next     bigint;
  v_seq      text;
begin
  select n.template, n.strategy into v_template, v_strategy
  from app.numerator n where n.model = p_model;

  if v_template is null then
    raise exception 'Нумератор моделі «%» не налаштовано', p_model
      using hint = 'Виконай deno task sql:assemble && deno task sql:publish';
  end if;

  v_scope := app.numerator_scope_key(p_model, p_scope);

  if v_strategy = 'sequence' then
    v_seq := app.numerator_sequence(p_model, v_scope);
    execute format('select nextval(%L)', v_seq) into v_next;
  else
    -- Звичайний DML: блокування рядка тримається до кінця транзакції, тож
    -- одночасні записи в цю область серіалізуються, а відкат ПОВЕРТАЄ номер.
    -- Саме цим counter відрізняється від sequence, і саме це дає суцільність.
    insert into app.numerator_state (model, scope_key, last_value)
    values (p_model, v_scope, 1)
    on conflict (model, scope_key) do update
      set last_value = app.numerator_state.last_value + 1
    returning last_value into v_next;
  end if;

  return app.numerator_render(v_template, v_next, p_scope, p_model);
end;
$$;

-- ── Підтягування лічильника під ручний номер ────────────────────────────────
-- Ручне значення лічильник не піднімає САМЕ ПО СОБІ, але лишити лічильник
-- позаду не можна: через кілька записів авто-номер упреться в уже зайнятий, і
-- виглядатиме це як поламана нумерація. Опустити лічильник не може ніколи.

drop function if exists app.numerator_bump_to(varchar, jsonb, varchar);
create function app.numerator_bump_to(p_model varchar, p_scope jsonb, p_number varchar)
returns void
language plpgsql
as $$
declare
  v_strategy varchar;
  v_template varchar;
  v_value    bigint;
  v_scope    varchar;
  v_seq      text;
  v_current  bigint;
begin
  select n.template, n.strategy into v_template, v_strategy
  from app.numerator n where n.model = p_model;
  if v_template is null then
    return;   -- модель без нумератора: номер цілком на совісті користувача
  end if;

  v_value := app.numerator_parse(p_model, p_scope, p_number);
  if v_value is null then
    return;   -- номер не за шаблоном — лічильника він не стосується
  end if;

  v_scope := app.numerator_scope_key(p_model, p_scope);

  if v_strategy = 'sequence' then
    v_seq := app.numerator_sequence(p_model, v_scope);
    execute format('select coalesce(pg_sequence_last_value(%L::regclass), 0)', v_seq) into v_current;
    if v_value > v_current then
      execute format('select setval(%L, %s)', v_seq, v_value);
    end if;
  else
    insert into app.numerator_state (model, scope_key, last_value)
    values (p_model, v_scope, v_value)
    on conflict (model, scope_key) do update
      set last_value = greatest(app.numerator_state.last_value, excluded.last_value);
  end if;
end;
$$;

-- ── Перевірка шаблона ───────────────────────────────────────────────────────
-- Живе в SQL, а не в збирачі, бо перевіряти доводиться двічі: при сіянні з
-- манифеста і при правці на екрані. Друга копія правил розійшлася б із першою.
--
-- p_document — єдине, чого SQL сам знати не може: тип моделі живе в
-- manifest.json. Той, хто кличе (збирач, екран нумераторів), каже його явно,
-- і ВСІ правила лишаються тут, а не діляться між SQL і TypeScript.

drop function if exists app.numerator_validate(varchar);
drop function if exists app.numerator_validate(varchar, varchar);
drop function if exists app.numerator_validate(varchar, varchar, boolean);
create function app.numerator_validate(
  p_template varchar,
  p_period   varchar default 'none',
  p_document boolean default true
) returns void
language plpgsql
immutable
as $$
declare
  v_rest text;
begin
  -- `using column` — прив'язка до поля форми на екрані нумераторів (template /
  -- period); при публікації сіду вона нікому не заважає.
  if p_template !~ '\{N+\}' then
    raise exception 'Шаблон нумератора «%» не містить лічильника {N…}', p_template
      using column = 'template';
  end if;

  if p_period not in ('none', 'year', 'month') then
    raise exception 'Період нумератора «%» невідомий', p_period
      using hint = 'Доступні: none, year, month', column = 'period';
  end if;

  -- Річна нумерація {YY} у шаблоні НЕ вимагає: рік у номері друкують не всі, а
  -- за унікальність відповідає індекс по даті документа, а не форма номера.
  --
  -- А от місячна вимагає {MM}, і це не смак: індекс річний (він один на
  -- таблицю), тож січневий і лютневий №1 зіткнулися б у ньому. Надрукований
  -- місяць їх розводить.
  if p_period = 'month' and p_template !~ '\{MM\}' then
    raise exception 'Шаблон нумератора «%»: місячний період вимагає {MM} у номері', p_template
      using hint = 'Унікальність номера перевіряється в межах року, тож місяць мусить бути видно',
            column = 'template';
  end if;

  if not p_document then
    -- Період ділить лічильник по ДАТІ ДОКУМЕНТА, якої в довідника немає;
    -- підставити now() не можна — код, виданий у січні, потрапив би в інший
    -- період, ніж грудневий.
    if p_period <> 'none' then
      raise exception 'Період нумератора «%» вимагає дати документа', p_period
        using hint = 'period працює для документів; довідник лишається на none',
              column = 'period';
    end if;
    -- Плейсхолдери документа в шаблоні довідника — не «зайва прикраса», а
    -- майбутні дублі: {ORG}/{TYPE} нема звідки взяти, а {YYYY}/{YY}/{MM}
    -- підставилися б із now(), тобто розбір торішнього коду перестав би його
    -- впізнавати — bump і пересів пропускали б видані номери, і авто-код
    -- упирався б у зайнятий.
    if p_template ~ '\{(ORG|TYPE|YYYY|YY|MM)\}' then
      raise exception 'Шаблон нумератора «%» містить плейсхолдер документа', p_template
        using hint = 'Модель без організації й дати нумерується текстом і {N…}',
              column = 'template';
    end if;
  end if;

  -- Невідомий плейсхолдер потрапив би в номер як є, і побачили б це лише на
  -- надрукованому документі.
  v_rest := p_template;
  v_rest := regexp_replace(v_rest, '\{(ORG|TYPE|YYYY|YY|MM|N+)\}', '', 'g');
  if v_rest ~ '[{}]' then
    raise exception 'Шаблон нумератора «%» містить невідомий плейсхолдер', p_template
      using hint = 'Доступні: {ORG} {TYPE} {YYYY} {YY} {MM} {N…}', column = 'template';
  end if;
end;
$$;

-- ── Пересів за збереженим джерелом ──────────────────────────────────────────
-- Обгортка над numerator_seed_from_existing для тих, хто знає лише ключ моделі
-- — насамперед екрана нумераторів. Аргументи джерела (таблиця, колонки) деплой
-- кладе в сам рядок нумератора з манифеста, тож зміна шаблона, періоду чи
-- стратегії на екрані пересівається тут же, без знання про будову моделі.

drop function if exists app.numerator_reseed(varchar);
create function app.numerator_reseed(p_model varchar)
returns void
language plpgsql
as $$
declare
  v_row app.numerator;
begin
  select * into v_row from app.numerator n where n.model = p_model;
  if v_row.model is null or v_row.source_table is null then
    return;   -- джерела немає (рядок завели повз деплой) — сіяти нема звідки
  end if;

  perform app.numerator_seed_from_existing(
    v_row.model,
    v_row.source_table,
    v_row.source_column,
    v_row.source_org_column,
    v_row.source_date_column,
    v_row.source_filter
  );
end;
$$;

-- ── Засів лічильників наявними даними ───────────────────────────────────────
-- Викликається зі згенерованого сіду після вставки самого нумератора. Береться
-- максимум уже виданого по кожній області — інакше перший же запис після
-- оновлення отримав би номер 1 і впав на унікальності.
--
-- Ідемпотентна: лічильник лише підіймається (greatest), тому повторний
-- deno task sql:publish на живій базі нічого не псує.

drop function if exists app.numerator_seed_from_existing(varchar, varchar, varchar, varchar, varchar, varchar);
create function app.numerator_seed_from_existing(
  p_model       varchar,
  p_table       varchar,               -- app.counterparty | app.document
  p_column      varchar,               -- code | number
  p_org_column  varchar default null,  -- organization_id (документ)
  p_date_column varchar default null,  -- doc_date (документ)
  p_filter      varchar default null   -- document_type_id = …
) returns void
language plpgsql
as $$
declare
  v_template varchar;
  v_org      text := case when p_org_column  is null then 'null' else format('t.%I', p_org_column)  end;
  v_date     text := case when p_date_column is null then 'null' else format('t.%I', p_date_column) end;
  v_scope    text;
  v_state    record;
  v_seq      text;
begin
  select n.template into v_template from app.numerator n where n.model = p_model;
  if v_template is null then
    return;
  end if;

  v_scope := format('jsonb_build_object(''orgId'', %s, ''date'', %s)', v_org, v_date);

  execute format(
    'insert into app.numerator_state (model, scope_key, last_value)
     select %1$L,
            app.numerator_scope_key(%1$L, %2$s),
            max(app.numerator_parse(%1$L, %2$s, t.%3$I))
     from %4$s t
     where %5$s
     group by 2
     having max(app.numerator_parse(%1$L, %2$s, t.%3$I)) is not null
     on conflict (model, scope_key) do update
       set last_value = greatest(app.numerator_state.last_value, excluded.last_value)',
    p_model,
    v_scope,
    p_column,
    p_table,
    coalesce(nullif(p_filter, ''), 'true')
  );

  -- Пересів мусить діставати й ПОСЛІДОВНОСТІ, що вже існують: ця функція
  -- оголошена єдиним засобом пересіву (зокрема після зміни strategy), а
  -- numerator_sequence засіває послідовність лише при СТВОРЕННІ. Без цього
  -- кроку перемикання counter → sequence на області, де послідовність колись
  -- уже була, лишало б її позаду стану — і видавало б зайняті номери.
  -- Нових послідовностей тут не створюємо (це справа першої видачі), а
  -- підтягування чинних безпечне за будь-якої стратегії: лічильник, як і
  -- скрізь у нумераторі, рухається лише вгору.
  for v_state in
    select s.scope_key, s.last_value
    from app.numerator_state s
    where s.model = p_model and s.last_value > 0
  loop
    v_seq := app.numerator_sequence_name(p_model, v_state.scope_key);
    if to_regclass(v_seq) is not null
       and coalesce(pg_sequence_last_value(v_seq::regclass), 0) < v_state.last_value then
      perform setval(v_seq::regclass, v_state.last_value);
    end if;
  end loop;
end;
$$;
