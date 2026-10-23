const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'dist/program-workflow-domain.js'), 'utf8');
const context = { window: {}, Intl, Date, Math, String, Array };
vm.runInNewContext(source, context);
const domain = context.window.CSSMoRAProgramWorkflowDomain;

test('program workflow progress and deadline reminders stay deterministic', () => {
  const milestones = [
    { status: 'completed' },
    { status: 'in_progress' },
    { status: 'pending' }
  ];
  assert.equal(domain.progressPercent(milestones), 33);
  assert.equal(domain.progressPercent([]), 0);
  assert.equal(domain.daysUntil('2026-10-23', '2026-10-23'), 0);
  assert.equal(domain.daysUntil('2026-10-20', '2026-10-23'), -3);

  const reminders = domain.reminderRows([
    { id: 'cycle-1', program_name: 'CSS Sport', status: 'ongoing', lpj_due_date: '2026-10-22' },
    { id: 'cycle-2', program_name: 'NGAJI', status: 'completed', lpj_due_date: '2026-10-22' },
    { id: 'cycle-3', program_name: 'Makrab', status: 'ongoing', lpj_due_date: '2026-11-15' }
  ], [
    { cycle_id: 'cycle-1', title: 'Publikasi', due_date: '2026-10-24', status: 'pending', program_name: 'CSS Sport' },
    { cycle_id: 'cycle-1', title: 'Selesai', due_date: '2026-10-20', status: 'completed' }
  ], '2026-10-23');
  assert.deepEqual(JSON.parse(JSON.stringify(reminders.map(row => [row.type, row.title, row.days]))), [
    ['lpj', 'CSS Sport · LPJ', -1],
    ['milestone', 'Publikasi', 1]
  ]);
});

test('program cycle migration preserves role boundaries and immutable review history', () => {
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261023190000_cssmora_program_tracking_lpj.sql'), 'utf8');
  assert.match(migration, /program_id uuid not null references public\.agenda_programs\(id\) on delete restrict/i);
  assert.match(migration, /CSSMoRA program roles update cycles[\s\S]*cssmora_user_has_role\('bph_departemen'\)/i);
  assert.match(migration, /new\.status in \('completed','revision'\)[\s\S]*cssmora\.lpj_review_action/i);
  assert.match(migration, /review_cssmora_program_lpj[\s\S]*cssmora_user_has_role\('ketua'\)[\s\S]*cssmora_user_has_role\('wakil'\)/i);
  assert.match(migration, /revoke all on public\.cssmora_program_cycle_history from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(?:select,\s*)?insert[^;]*cssmora_program_cycle_history/i);
  assert.match(migration, /returns table \([\s\S]*eligible_count bigint,[\s\S]*present_count bigint\s*\)/i);
  assert.doesNotMatch(migration, /returns table \([\s\S]{0,300}(?:full_name|member_name|proof_path)/i);
  assert.match(migration, /Financial entries remain in AkunPro/i);
});

test('program tracking UI is an additive tab and includes LPJ, checkpoints, reminders, and recap', () => {
  const html = fs.readFileSync(path.join(root, 'dist/admin.html'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'dist/program-workflow.js'), 'utf8');
  assert.match(html, /id="tab-program-workflow"[\s\S]*Progres &amp; LPJ/);
  assert.match(html, /id="program-milestone-form"/);
  assert.match(html, /id="program-reminder-list"/);
  assert.match(html, /id="program-cycle-recap-list"/);
  assert.match(client, /rpc\/review_cssmora_program_lpj/);
  assert.match(client, /rpc\/get_cssmora_program_cycle_attendance/);
  assert.match(client, /downloadLpj/);
  assert.doesNotMatch(client, /cssmora_finance_(budgets|transactions)/);
});
