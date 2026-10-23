const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'dist/prestasi.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261023070254_cssmora_achievement_subsidy_rule_v2.sql'),
  'utf8'
);
const helperStart = frontend.indexOf('function groupSubsidyRate');
const helperEnd = frontend.indexOf('function renderLeaderOptions');
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Subsidy helpers must remain testable');
const policy = vm.createContext({});
vm.runInContext(frontend.slice(helperStart, helperEnd), policy);

test('team subsidy applies the four approved fee bands at exact boundaries', () => {
  for (const [fee, expectedRate] of [
    [0, 1], [15000, 1], [15001, 0.75], [50000, 0.75],
    [50001, 0.5], [80000, 0.5], [80001, 0.25]
  ]) assert.equal(policy.groupSubsidyRate(fee), expectedRate, `fee ${fee}`);
});

test('team request is rounded from the paid total and capped at Rp40,000', () => {
  for (const [fee, expected] of [
    [15000, 15000], [15001, 11251], [20000, 15000], [40000, 30000],
    [50000, 37500], [50001, 25001], [60000, 30000], [80000, 40000],
    [80001, 20000], [160000, 40000], [200000, 40000]
  ]) assert.equal(policy.subsidyAmount('tim', fee), expected, `fee ${fee}`);
});

test('individual request is half of the team amount, including the cap', () => {
  for (const [fee, expected] of [
    [12000, 6000], [20000, 7500], [60000, 15000],
    [80000, 20000], [160000, 20000], [200000, 20000]
  ]) assert.equal(policy.subsidyAmount('individu', fee), expected, `fee ${fee}`);
});

test('the UI shows the effective rate when the Rp40,000 cap applies', () => {
  assert.equal(policy.subsidyRate('tim', 200000), 0.2);
  assert.equal(policy.subsidyRate('individu', 200000), 0.1);
});

test('the database versions the formula and preserves already-filed requests', () => {
  assert.match(migration, /add column subsidy_rule_version smallint not null default 1/i);
  assert.match(migration, /alter column subsidy_rule_version set default 2/i);
  assert.match(migration, /p_fee_amount <= 15000 then 1\.000/i);
  assert.match(migration, /least\([\s\S]*40000/i);
  assert.ok(migration.includes("::numeric / p_fee_amount"), "The stored percentage reflects the capped amount.");
  assert.match(migration, /generated always as \([\s\S]*subsidy_rule_version/i);
  assert.match(migration, /Versi aturan subsidi yang digunakan ketika pengajuan dibuat/i);
});
