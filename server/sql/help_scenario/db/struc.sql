create table if not exists app.help_scenario (
    id          bigint generated always as identity primary key,
    slug        text        not null,
    title       text        not null,
    content     text        not null,
    tags        text[]      not null default '{}',
    lang        char(2)     not null default 'uk',
    updated_at  timestamptz not null default now(),
    updated_by  text,

    constraint uq_help_scenario unique (slug, lang)
);

create index if not exists ix_help_scenario_tags on app.help_scenario using gin(tags);

comment on table  app.help_scenario             is 'Бізнес-процесні сценарії та інструкції для користувачів';
comment on column app.help_scenario.slug        is 'Унікальний технічний ідентифікатор сценарію, наприклад close-month';
comment on column app.help_scenario.title       is 'Назва сценарію, відображається у пошуку';
comment on column app.help_scenario.content     is 'Покроковий опис сценарію у форматі Markdown';
comment on column app.help_scenario.tags        is 'Теги для класифікації та фільтрації сценаріїв';
comment on column app.help_scenario.lang        is 'Код мови (uk, en)';
comment on column app.help_scenario.updated_by  is 'Джерело запису: agent | admin';
