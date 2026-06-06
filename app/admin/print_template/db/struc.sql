create table if not exists app.print_template (
  id uuid primary key default gen_random_uuid(),
  code varchar(80) not null,
  name varchar(250) not null,
  target_model varchar(80) not null,
  data_command varchar(80) not null default 'load',
  paper_size varchar(20) not null default 'A4',
  orientation varchar(20) not null default 'portrait',
  is_default boolean not null default false,
  is_active boolean not null default true,
  template_schema jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_template_code_key unique (code),
  constraint print_template_paper_size_check check (paper_size in ('A4')),
  constraint print_template_orientation_check check (orientation in ('portrait', 'landscape'))
);

create unique index if not exists idx_print_template_one_default_per_model
  on app.print_template(target_model)
  where is_default;

create index if not exists idx_print_template_target_model on app.print_template(target_model);
create index if not exists idx_print_template_active on app.print_template(is_active);