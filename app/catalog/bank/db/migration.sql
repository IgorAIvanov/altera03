alter table if exists app.bank
  add column if not exists mfo varchar(6);
