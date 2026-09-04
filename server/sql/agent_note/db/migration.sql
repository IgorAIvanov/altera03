-- Другий вид записки — тема (`kind = 'topic'`): процедура, у якої завжди їде
-- лише покажчик, а тіло агент забирає командою. Базі, заведеній до цього,
-- бракує чотирьох колонок.
alter table app.agent_note add column if not exists kind    varchar(20) not null default 'note';
alter table app.agent_note add column if not exists slug    varchar(100);
alter table app.agent_note add column if not exists title   varchar(200);
alter table app.agent_note add column if not exists summary text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_agent_note_kind'
  ) then
    alter table app.agent_note
      add constraint ck_agent_note_kind check (kind in ('note', 'topic'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ck_agent_note_topic'
  ) then
    alter table app.agent_note
      add constraint ck_agent_note_topic check (
        kind <> 'topic' or (
          length(btrim(coalesce(slug, ''))) > 0
          and length(btrim(coalesce(title, ''))) > 0
          and length(btrim(coalesce(summary, ''))) > 0
        )
      );
  end if;
end $$;

-- Ім'я теми — те, чим її забирає агент, тож двох однакових бути не може.
--
-- Індекс і коментарі стоять ТУТ, а не в `struc.sql`, і це не смак: порядок
-- збірки — структура, потім міграції. На базі, заведеній до появи колонок,
-- `create table if not exists` не додає нічого, і все, що згадує `slug` чи
-- `kind` на кроці структури, падає ще до того, як міграція ці колонки заведе.
create unique index if not exists uq_agent_note_slug
  on app.agent_note (slug) where slug is not null;

comment on column app.agent_note.kind    is 'note — одна думка, їде завжди; topic — процедура, їде покажчиком';
comment on column app.agent_note.slug    is 'Ім''я теми, яким її забирає агент: close-month';
comment on column app.agent_note.title   is 'Назва теми для людини';
comment on column app.agent_note.summary is 'Коли ця тема потрібна — рядок покажчика, який лежить у контексті завжди';
