const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'dist/prestasi.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261023090516_cssmora_achievement_subsidy_rule_v3.sql'),
  'utf8'
);
const helperStart = frontend.indexOf('function groupSubsidyRate');
const helperEnd = frontend.indexOf('function renderLeaderOptions');
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Subsidy helpers must remain testable');
const policy = vm.createContext({});
vm.runInContext(frontend.slice(helperStart, helperEnd), policy);

test('marginal subsidy rates cover four bands without falling at boundaries', () => {
  for (const [fee, rate] of [
    [0, 1], [15000, 1], [15001, 0.75], [25000, 0.75],
    [25001, 0.5], [40000, 0.5], [40001, 0.25], [80000, 0.25], [80001, 0]
  ]) assert.equal(policy.groupSubsidyRate(fee), rate, `fee ${fee}`);
  const fees = [0, 15000, 15001, 20000, 25000, 25001, 40000, 40001, 50000, 60000, 80000, 80001, 200000];
  const amounts = fees.map(fee => policy.subsidyAmount('tim', fee));
  for (let i = 1; i < amounts.length; i++) {
    assert.ok(amounts[i] >= amounts[i - 1], `team subsidy fell at fee ${fees[i]}`);
  }
});

test('team amounts apply the marginal rate only to each fee slice and cap at Rp40,000', () => {
  for (const [fee, expected] of [
    [15000, 15000], [15001, 15001], [20000, 18750], [25000, 22500],
    [25001, 22501], [40000, 30000], [40001, 30000], [50000, 32500],
    [60000, 35000], [80000, 40000], [80001, 40000], [160000, 40000]
  ]) assert.equal(policy.subsidyAmount('tim', fee), expected, `fee ${fee}`);
});

test('individual receives half of the calculated team subsidy, capped at Rp20,000', () => {
  for (const [fee, expected] of [
    [12000, 6000], [20000, 9375], [25001, 11251], [50000, 16250],
    [60000, 17500], [80000, 20000], [160000, 20000]
  ]) assert.equal(policy.subsidyAmount('individu', fee), expected, `fee ${fee}`);
});

test('the UI shows the effective rate after the team cap', () => {
  assert.equal(policy.subsidyRate('tim', 200000), 0.2);
  assert.equal(policy.subsidyRate('individu', 200000), 0.1);
});

test('migration preserves versions 1 and 2 while defaulting new requests to version 3', () => {
  assert.ok(migration.includes('check (subsidy_rule_version in (1, 2, 3))'));
  assert.match(migration, /alter column subsidy_rule_version set default 3/i);
  assert.ok(migration.indexOf('when 1 then') < migration.indexOf('when 2 then'));
  assert.ok(migration.indexOf('when 2 then') < migration.indexOf('when 3 then'));
  assert.ok(migration.includes('p_fee_amount <= 25000'));
  assert.ok(migration.includes('p_fee_amount <= 40000'));
  assert.ok(migration.includes('p_fee_amount <= 80000'));
  assert.ok(migration.toLowerCase().includes('generated always as'));
  assert.ok(migration.includes('cssmora_achievement_subsidy_amount_for_rule(p_participation_type, p_fee_amount, 3::smallint)'));
  assert.doesNotMatch(migration.toLowerCase(), /delete\s+from|truncate\s+table|drop\s+table/);
  assert.doesNotMatch(migration.toLowerCase(), /security\s+definer/);
});
