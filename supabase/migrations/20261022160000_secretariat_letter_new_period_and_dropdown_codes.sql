-- Begin a fresh numbering period (2026/2027) while preserving all issued records.
alter table public.secretariat_letters
  add column if not exists period_start_year smallint;

-- Existing rows belong to the previous 2025/2026 period. Preserve the old counter.
update public.secretariat_letters
set period_start_year = 2025
where period_start_year is null;

alter table public.secretariat_letters
  alter column period_start_year set default 2026,
  alter column period_start_year set not null;

alter table public.secretariat_letters
  drop constraint if exists secretariat_letters_year_sequence_number_key;
alter table public.secretariat_letters
  add constraint secretariat_letters_period_sequence_key
  unique (period_start_year, sequence_number);

-- Counters are keyed by period, not by the calendar year printed from issued_on.
alter table public.secretariat_letter_counters
  rename column year to period_start_year;

insert into public.secretariat_letter_counters (period_start_year, last_number)
select 2025, greatest(coalesce(max(last_number), 0), coalesce((select max(sequence_number) from public.secretariat_letters where period_start_year = 2025), 0))
from public.secretariat_letter_counters
on conflict (period_start_year) do update
set last_number = greatest(public.secretariat_letter_counters.last_number, excluded.last_number), updated_at = now();

insert into public.secretariat_letter_counters (period_start_year, last_number)
values (2026, 0)
on conflict (period_start_year) do update
set last_number = 0, updated_at = now();

drop function if exists public.issue_secretariat_letter(date,text,text,text,text,text,smallint,text);

create function public.issue_secretariat_letter(
  p_issued_on date,
  p_subject text,
  p_scope_code text,
  p_type_code text,
  p_department_code text,
  p_recipient text default null,
  p_attachment_count smallint default 0,
  p_archive_url text default null,
  p_period_start_year smallint default 2026
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_year smallint;
  v_seq integer;
  v_roman text;
  v_number text;
  v_id uuid;
  v_scope text := lower(btrim(p_scope_code));
  v_type text := upper(btrim(p_type_code));
  v_dept_input text := upper(btrim(p_department_code));
  v_department text;
begin
  if auth.uid() is null or not public.is_secretariat_admin() then
    raise exception 'Akses pengurus CSSMoRA diperlukan.';
  end if;
  if p_issued_on is null or length(btrim(coalesce(p_subject, ''))) not between 3 and 240 then
    raise exception 'Tanggal dan perihal surat wajib diisi dengan benar.';
  end if;
  if v_scope not in ('i', 'e') then raise exception 'Cakupan surat tidak valid.'; end if;
  if v_type not in ('SK','SB','SR','SG','SM','ST','SP','SN','SU','SO','SH','SA') then
    raise exception 'Jenis surat tidak terdaftar.';
  end if;
  v_department := case v_dept_input
    when 'BPH' then 'CSSMoRA-UNAIR'
    when 'PSDM' then 'XI.01'
    when 'P3M' then 'XI.02'
    when 'ADVO' then 'XI.03'
    when 'MEDINFO' then 'XI.04'
    else null
  end;
  if v_department is null then raise exception 'Divisi penerbit tidak terdaftar.'; end if;
  if p_period_start_year is distinct from 2026 then raise exception 'Periode penomoran aktif adalah 2026/2027.'; end if;

  v_year := extract(year from p_issued_on)::smallint;
  insert into public.secretariat_letter_counters (period_start_year, last_number)
  values (p_period_start_year, 1)
  on conflict (period_start_year) do update
    set last_number = public.secretariat_letter_counters.last_number + 1, updated_at = now()
  returning last_number into v_seq;

  v_roman := case extract(month from p_issued_on)::integer
    when 1 then 'I' when 2 then 'II' when 3 then 'III' when 4 then 'IV'
    when 5 then 'V' when 6 then 'VI' when 7 then 'VII' when 8 then 'VIII'
    when 9 then 'IX' when 10 then 'X' when 11 then 'XI' when 12 then 'XII'
  end;
  v_number := lpad(v_seq::text, 3, '0') || '/' || v_scope || '/' || v_type || '/' || v_department || '/' || v_roman || '/' || v_year::text;

  insert into public.secretariat_letters(
    year, period_start_year, sequence_number, issued_on, subject, scope_code, type_code,
    department_code, letter_number, recipient, attachment_count, archive_url, archive_status, created_by
  ) values (
    v_year, p_period_start_year, v_seq, p_issued_on, btrim(p_subject), v_scope, v_type,
    v_department, v_number, nullif(btrim(p_recipient), ''), coalesce(p_attachment_count, 0),
    nullif(btrim(p_archive_url), ''),
    case when nullif(btrim(p_archive_url), '') is null then 'pending' else 'archived' end,
    auth.uid()
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'letter_number', v_number, 'sequence_number', v_seq, 'period_start_year', p_period_start_year);
end;
$$;

revoke all on function public.issue_secretariat_letter(date,text,text,text,text,text,smallint,text,smallint) from public, anon;
grant execute on function public.issue_secretariat_letter(date,text,text,text,text,text,smallint,text,smallint) to authenticated;
