const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../dist/workflow-domain.js');

test('finance journal maps income and expense to balanced AkunPro lines', () => {
  assert.deepEqual(domain.createJournal('income', 125000, '1101', '4101'), [
    { account_code: '1101', debit: 125000, credit: 0 },
    { account_code: '4101', debit: 0, credit: 125000 },
  ]);
  assert.deepEqual(domain.createJournal('expense', 80000, '1101', '5101'), [
    { account_code: '5101', debit: 80000, credit: 0 },
    { account_code: '1101', debit: 0, credit: 80000 },
  ]);
  assert.throws(() => domain.createJournal('expense', 10, '1101', '1101'), /kode akun/i);
  assert.throws(() => domain.createJournal('income', 0, '1101', '4101'), /nominal/i);
});

test('budget actual counts linked expenses only and compares against RKAP', () => {
  const transactions = [
    { budget_id: 'b1', direction: 'expense', amount: 40000 },
    { budget_id: 'b1', direction: 'expense', amount: 25000 },
    { budget_id: 'b1', direction: 'income', amount: 100000 },
    { budget_id: 'b2', direction: 'expense', amount: 90000 },
  ];
  assert.deepEqual(domain.budgetComparison(100000, 90000, transactions, 'b1'), {
    actual: 65000, variance: -35000, forecastVariance: -10000, remaining: 35000,
  });
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

test('AkunPro sync checks a signed-in CSSMoRA finance role and signs server-to-server requests', () => {
  const endpoint = fs.readFileSync(path.join(__dirname, '../supabase/functions/akunpro-integration/index.ts'), 'utf8');
  assert.match(endpoint, /auth\/v1\/user/);
  assert.match(endpoint, /\["ketua", "wakil", "bendahara"\]/);
  assert.match(endpoint, /AKUNPRO_BRIDGE_SECRET/);
  assert.match(endpoint, /X-CSSMoRA-Signature/);
  assert.match(endpoint, /claim_cssmora_finance_transaction/);
  assert.match(endpoint, /release_cssmora_finance_transaction/);
  assert.doesNotMatch(endpoint, /AKUNPRO_BRIDGE_SECRET\s*\}\s*\}/);
});
