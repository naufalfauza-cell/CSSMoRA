create table public.cssmora_drive_attendance_recap_sync (
  singleton boolean primary key default true check (singleton),
  spreadsheet_id text not null,
  generation bigint not null default 0,
  pending boolean not null default true,
  attempts integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into public.cssmora_drive_attendance_recap_sync
  (singleton, spreadsheet_id, generation, pending, attempts, last_error)
values
  (true, '1DrQlx6ueGv0mzryuh45tfMF0ezlbJ5V4nLPcJCDSD8M', 1, true, 0, null);

alter table public.cssmora_drive_attendance_recap_sync enable row level security;
revoke all on public.cssmora_drive_attendance_recap_sync from public, anon, authenticated;
grant all on public.cssmora_drive_attendance_recap_sync to service_role;

create or replace function public.enqueue_cssmora_attendance_recap_sheet_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.cssmora_drive_attendance_recap_sync
  set generation = generation + 1,
      pending = true,
      attempts = 0,
      last_error = null,
      updated_at = pg_catalog.now()
  where singleton is true;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.enqueue_cssmora_attendance_recap_sheet_sync() from public, anon, authenticated;

create trigger cssmora_attendance_records_recap_sheet_sync
  after insert or update or delete on public.secretariat_attendance_records
  for each row execute function public.enqueue_cssmora_attendance_recap_sheet_sync();

create trigger cssmora_attendance_permissions_recap_sheet_sync
  after insert or update or delete on public.secretariat_attendance_permissions
  for each row execute function public.enqueue_cssmora_attendance_recap_sheet_sync();

create trigger cssmora_attendance_events_recap_sheet_sync
  after insert or update or delete on public.secretariat_attendance_events
  for each row execute function public.enqueue_cssmora_attendance_recap_sheet_sync();

create trigger cssmora_agenda_recap_sheet_sync
  after insert or update or delete on public.agenda
  for each row execute function public.enqueue_cssmora_attendance_recap_sheet_sync();

create trigger cssmora_members_recap_sheet_sync
  after insert or update or delete on public.secretariat_members
  for each row execute function public.enqueue_cssmora_attendance_recap_sheet_sync();
