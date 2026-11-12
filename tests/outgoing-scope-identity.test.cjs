const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('outgoing signatures use NIM for internal scope and NIA for external scope', async () => {
  const { letterIdentityKind, chairIdentityReplacements } = await import('../supabase/functions/drive-integration/letter-templates.ts');
  const chair = { nim: '12345', nia: 'C000001' };
  assert.equal(chairIdentityReplacements(letterIdentityKind('i'), chair, 'pinjam')[0][1], 'NIM. 12345');
  assert.equal(chairIdentityReplacements(letterIdentityKind('e'), chair, 'pinjam')[0][1], 'NIA. C000001');
  const edge = fs.readFileSync(require.resolve('../supabase/functions/drive-integration/index.ts'), 'utf8');
  assert.match(edge, /identityKind = letterIdentityKind\(scope/);
  assert.doesNotMatch(edge, /body\.identity_kind/);
});

test('secretary signature masters resolve the roster identity for both scopes', async () => {
  const { letterTemplates, secretaryIdentityReplacement, secretaryTemplateNia } = await import('../supabase/functions/drive-integration/letter-templates.ts');
  assert.deepEqual(letterTemplates.filter(template => template.hasSecretarySignature).map(template => template.key).sort(),
    ['izin', 'pengantar-lpj', 'pengantar-proposal', 'pinjam', 'wisuda']);
  const secretary = {nim:'12345', nia:secretaryTemplateNia};
  assert.deepEqual(secretaryIdentityReplacement('NIM', secretary), ['NIM/NIA. ' + secretaryTemplateNia, 'NIM. 12345']);
  assert.deepEqual(secretaryIdentityReplacement('NIA', secretary), ['NIM/NIA. ' + secretaryTemplateNia, 'NIA. ' + secretaryTemplateNia]);
  assert.equal(secretaryIdentityReplacement('NIM', {nim:''}), null);
});
