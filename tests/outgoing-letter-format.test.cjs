const { test } = require('node:test');
const assert = require('node:assert/strict');

test('masters with an embedded appendix require at least one attachment', async () => {
  const { letterTemplates } = await import('../supabase/functions/drive-integration/letter-templates.ts');
  assert.deepEqual(
    letterTemplates.filter(template => template.minimumAttachments > 0).map(template => template.key),
    ['wisuda', 'undangan-instansi', 'undangan-umum']
  );
  assert.ok(letterTemplates.filter(template => template.code === 'SU').every(template => template.niaFields.length === 2));
});

test('prefixed identity fields preserve the master label and refuse a NIM for an NIA-only field', async () => {
  const { normalizeLetterIdentity } = await import('../supabase/functions/drive-integration/letter-templates.ts');
  assert.equal(normalizeLetterIdentity('NIA. C0924001', true), 'C0924001');
  assert.equal(normalizeLetterIdentity('NIM 042410000001', true), null);
  assert.equal(normalizeLetterIdentity('C0924001', true), 'C0924001');
  assert.equal(normalizeLetterIdentity('NIM: 042410000001', false), '042410000001');
});
