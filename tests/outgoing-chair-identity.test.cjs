const { test } = require('node:test');
const assert = require('node:assert/strict');

test('the chair identity follows the chosen label in signatures and the assignment body', async () => {
  const { chairIdentityReplacements } = await import('../supabase/functions/drive-integration/letter-templates.ts');
  const chair = { nim: '12345', nia: 'C000001' };
  for (const [kind, number] of [['NIM', chair.nim], ['NIA', chair.nia]]) {
    assert.deepEqual(chairIdentityReplacements(kind, chair, 'tugas'), [
      ['NIM/NIA. C000001', kind + '. ' + number],
      ['NIA/NIM : C000001', kind + ' : ' + number],
    ]);
    assert.deepEqual(chairIdentityReplacements(kind, chair, 'undangan-instansi'), [
      ['NIA. C000001', kind + '. ' + number],
    ]);
  }
});
