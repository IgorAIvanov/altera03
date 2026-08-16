-- Звірка двох знімків ledger-equivalence.sql: public.ledger_before проти
-- public.ledger_after. Мовчазний «ALL MATCH» — те, заради чого стенд існує.
select coalesce(
  (select string_agg(
     format('%s (%s): було %s/%s, стало %s/%s',
            coalesce(b.case_id, a.case_id), coalesce(b.note, a.note),
            b.row_count, b.digest, a.row_count, a.digest), E'\n' order by coalesce(b.case_id, a.case_id))
   from public.ledger_before b
   full join public.ledger_after a using (case_id)
   where b.digest is distinct from a.digest or b.row_count is distinct from a.row_count),
  'ALL MATCH'
) as verdict;
