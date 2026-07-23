create table if not exists app.help_content (
    id          bigint generated always as identity primary key,
    model_key   text        not null,
    field_key   text,
    lang        char(2)     not null default 'uk',
    content     text        not null,
    kind        text        not null default 'tooltip',
    updated_at  timestamptz not null default now(),
    updated_by  text,

    constraint uq_help_content unique (model_key, field_key, lang, kind)
);

comment on table  app.help_content                is 'Контекстна довідка для екранів та полів';
comment on column app.help_content.model_key      is 'Ключ моделі з manifest.json, наприклад supplier_invoice';
comment on column app.help_content.field_key      is 'Ключ поля форми; null означає підказку для всього екрану';
comment on column app.help_content.lang           is 'Код мови (uk, en)';
comment on column app.help_content.content        is 'Текст підказки у форматі Markdown';
comment on column app.help_content.kind           is 'Місце відображення: tooltip | inline | chat';
comment on column app.help_content.updated_by     is 'Джерело запису: agent | admin';
