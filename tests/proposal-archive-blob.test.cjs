const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('proposal archive reads the Storage Blob as text before parsing JSON', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/program-document-assistant/index.ts'), 'utf8');
  assert.match(source, /validateProposalArchive\(JSON\.parse\(await data\.text\(\)\)\)/);
  const data = new Blob([JSON.stringify([{ id: 'kpu', label: 'KPU' }])], { type: 'application/json' });
  assert.equal(typeof data.json, 'undefined');
  assert.deepEqual(JSON.parse(await data.text()), [{ id: 'kpu', label: 'KPU' }]);
});
