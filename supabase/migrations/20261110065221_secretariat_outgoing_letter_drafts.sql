create table public.secretariat_outgoing_letter_drafts (
  id uuid primary key,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  template_key text not null,
  title text not null,
  subject text not null,
  issued_on date not null,
  recipient text,
  scope_code text not null check (scope_code in ('i','e')),
  type_code text not null check (type_code in ('SO','SU','SP','ST')),
  department_code text not null check (department_code in ('BPH','PSDM','P3M','ADVO','MEDINFO')),
  attachment_count smallint not null check (attachment_count between 0 and 99),
  document_id text unique,
  letter_id uuid unique references public.secretariat_letters(id) on delete restrict
);

alter table public.secretariat_outgoing_letter_drafts enable row level security;
revoke all on public.secretariat_outgoing_letter_drafts from public, anon, authenticated;
grant select on public.secretariat_outgoing_letter_drafts to authenticated;
grant select, insert, update, delete on public.secretariat_outgoing_letter_drafts to service_role;
create policy "Sekretaris membaca draf surat"
  on public.secretariat_outgoing_letter_drafts for select to authenticated
  using ((select public.cssmora_user_has_role('sekretaris')));

create function public.issue_secretariat_outgoing_draft(p_draft_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  draft public.secretariat_outgoing_letter_drafts%rowtype;
  issued jsonb;
begin
  if auth.uid() is null or not public.cssmora_user_has_role('sekretaris') then
    raise exception 'Penomoran draf hanya tersedia untuk sekretaris.' using errcode = '42501';
  end if;

  select * into draft from public.secretariat_outgoing_letter_drafts
    where id = p_draft_id for update;
  if not found or draft.document_id is null then
    raise exception 'Google Docs draf belum tersedia.';
  end if;

  if draft.letter_id is not null then
    return (select jsonb_build_object('id', id, 'letter_number', letter_number)
      from public.secretariat_letters where id = draft.letter_id);
  end if;

  issued := public.issue_secretariat_letter(
    p_issued_on => draft.issued_on, p_subject => draft.subject,
    p_scope_code => draft.scope_code, p_type_code => draft.type_code,
    p_department_code => draft.department_code, p_recipient => draft.recipient,
    p_attachment_count => draft.attachment_count, p_period_start_year => 2026::smallint
  );
  update public.secretariat_outgoing_letter_drafts
    set letter_id = (issued->>'id')::uuid where id = p_draft_id;
  return issued;
end;
$$;

revoke all on function public.issue_secretariat_outgoing_draft(uuid) from public, anon;
grant execute on function public.issue_secretariat_outgoing_draft(uuid) to authenticated;
