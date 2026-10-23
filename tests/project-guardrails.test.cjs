const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const rules = read('PROJECT_RULES.md');

test('locked product and permission decisions remain documented', () => {
  for (const phrase of [
    'Ketua dan Wakil Ketua',
    'BPH/departemen',
    'Gangguan jaringan sementara',
    'paling banyak enam agenda',
    'setelah lima hari',
    'Rp15.001–50.000 sebesar 75%',
    'Bendahara lalu Ketua',
    'Periode baru 2026/2027 mulai dari nomor 1',
    'Migrasi yang telah diterapkan ke Supabase bersifat append-only'
  ]) assert.ok(rules.includes(phrase), `Missing protected decision: ${phrase}`);
});

test('all supported AI instruction files point to the canonical rules', () => {
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md']) {
    assert.ok(read(file).includes('PROJECT_RULES.md'), `${file} must reference PROJECT_RULES.md`);
  }
});

test('protected paths are assigned to the project owner', () => {
  const owners = read('.github/CODEOWNERS');
  for (const pathName of ['/PROJECT_RULES.md', '/AGENTS.md', '/.github/', '/tests/', '/supabase/migrations/']) {
    assert.ok(owners.includes(pathName), `Missing Code Owner protection for ${pathName}`);
  }
});

test('GitHub Actions runs the complete regression suite', () => {
  const workflow = read('.github/workflows/guardrails.yml');
  for (const file of ['agenda.test.cjs', 'known-audit-regressions.cjs', 'rescreen-regressions.cjs', 'project-guardrails.test.cjs', 'subsidy-policy.test.cjs']) {
    assert.ok(workflow.includes(file), `Workflow must run ${file}`);
  }
});
