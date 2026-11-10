create table public.secretariat_outgoing_letter_masters (
  template_key text primary key check (template_key in ('pinjam','izin','wisuda','undangan-instansi','undangan-umum','pengantar-lpj','pengantar-proposal','tugas')),
  document_id text not null unique check (document_id ~ '^[A-Za-z0-9_-]{15,150}$'),
  configured_at timestamptz not null default now()
);
alter table public.secretariat_outgoing_letter_masters enable row level security;
revoke all on public.secretariat_outgoing_letter_masters from public, anon, authenticated;
grant select on public.secretariat_outgoing_letter_masters to service_role;
