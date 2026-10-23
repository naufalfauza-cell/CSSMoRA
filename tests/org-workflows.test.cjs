const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../dist/workflow-domain.js');

test('finance entry opens AkunPro and does not collect accounting data in CSSMoRA', () => {
  const html = fs.readFileSync(path.join(__dirname, '../dist/admin.html'), 'utf8');
  const workflows = fs.readFileSync(path.join(__dirname, '../dist/workflows.js'), 'utf8');
  assert.match(html, /Buka pencatatan di AkunPro/);
  assert.match(html, /href="https:\/\/akunpro-one\.vercel\.app" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Buka AkunPro/);
  assert.doesNotMatch(html, /id="finance-entry-form"|id="finance-budget-form"|Catat transaksi|Tambah pos anggaran/);
  assert.doesNotMatch(workflows, /cssmora_finance_(budgets|transactions)|akunpro-integration|loadFinanceDashboard/);
});

test('achievement participant selection requires roster IDs and a real team', () => {
  assert.deepEqual(domain.participantIds('individu', 'member-1'), ['member-1']);
  assert.deepEqual(domain.participantIds('tim', 'member-1', ['member-2', 'member-2']), ['member-1', 'member-2']);
  assert.throws(() => domain.participantIds('tim', 'member-1'), /minimal dua/i);
  assert.throws(() => domain.participantIds('individu', '', []), /pilih nama/i);
});

test('workflow migration keeps finance private and public recap limited to approved rows', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261023140000_cssmora_admin_workflows.sql'), 'utf8');
  assert.match(migration, /alter table public\.cssmora_finance_transactions enable row level security/i);
  assert.match(migration, /grant insert \(transaction_date, reference, description, direction, amount, cash_account_code, category_account_code, budget_id\)/i);
  assert.doesNotMatch(migration, /grant select, insert, update on public\.cssmora_finance_transactions to authenticated/i);
  assert.match(migration, /cssmora_user_has_role\('bendahara'\)/i);
  assert.match(migration, /sync_status text not null default 'pending' check \(sync_status in \('pending','syncing','synced'\)\)/i);
  assert.match(migration, /claim_cssmora_finance_transaction[\s\S]*for update[\s\S]*interval '10 minutes'/i);
  assert.match(migration, /where r\.status = 'approved'/i);
  assert.match(migration, /public = false/i);
  assert.match(migration, /grant execute on function public\.submit_cssmora_achievement_record[\s\S]*to service_role/i);
  assert.match(migration, /grant execute on function public\.review_cssmora_achievement_record[\s\S]*to authenticated/i);
  assert.match(migration, /p_certificate_path !~ \('\^records\/' \|\| p_id::text/i);
  assert.match(migration, /group by r\.id, r\.created_at/i);
  assert.match(migration, /cssmora_achievement_record_ip_submission_limits/);
  assert.match(migration, /returns table\(id uuid, full_name text\)/i);
  assert.match(migration, /p_event_date > \(pg_catalog\.now\(\) at time zone 'Asia\/Jakarta'\)::date/i);
});

test('public achievement upload uses a private bucket and server-side origin and rate checks', () => {
  const endpoint = fs.readFileSync(path.join(__dirname, '../supabase/functions/submit-achievement-record/index.ts'), 'utf8');
  assert.match(endpoint, /cssmora-achievement-certificates/);
  assert.match(endpoint, /consume_cssmora_achievement_record_ip_limit/);
  assert.match(endpoint, /allowedOrigin\(origin\)/);
  assert.match(endpoint, /image\/webp/);
  assert.match(endpoint, /submit_cssmora_achievement_record/);
});

test('AkunPro bridge is server-authenticated and unused by the CSSMoRA client', () => {
  const endpoint = fs.readFileSync(path.join(__dirname, '../supabase/functions/akunpro-integration/index.ts'), 'utf8');
  const workflows = fs.readFileSync(path.join(__dirname, '../dist/workflows.js'), 'utf8');
  assert.match(endpoint, /auth\/v1\/user/);
  assert.match(endpoint, /\["ketua", "wakil", "bendahara"\]/);
  assert.match(endpoint, /AKUNPRO_BRIDGE_SECRET/);
  assert.match(endpoint, /X-CSSMoRA-Signature/);
  assert.match(endpoint, /claim_cssmora_finance_transaction/);
  assert.match(endpoint, /release_cssmora_finance_transaction/);
  assert.doesNotMatch(workflows, /akunpro-integration|requestAkunPro/);
});
