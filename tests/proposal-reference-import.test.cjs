const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {validateProposalArchive, archivedProposalSections} = require('../supabase/functions/program-document-assistant/archive.ts');

const entry = {
  id: 'css-sport', label: 'CSS-SPORT',
  proposal: 'https://docs.google.com/document/d/proposal_example/edit',
  lpj: 'https://drive.google.com/file/d/lpj_example/view',
  fields: {background: 'Paragraf asli.\nParagraf kedua.', goals: 'Tujuan asli.', closing: 'Penutup asli.'},
};

test('archive import preserves text and leaves missing sections blank', () => {
  const [validated] = validateProposalArchive([entry]);
  assert.deepEqual(validated, entry);
  const sections = archivedProposalSections({...validated.fields, archive_reference: validated.id, background: 'Teks pengurus.\nBaris kedua.'});
  assert.equal(sections.background, 'Teks pengurus.\nBaris kedua.');
  assert.equal(sections.theme_section, '');
  assert.equal(sections.schedule_section, '');
  assert.equal(archivedProposalSections({background: 'Draf lama'}), null);
});

test('archive catalog rejects duplicate references, unsafe links and invalid section text', () => {
  assert.throws(() => validateProposalArchive([entry,entry]), /duplikat/);
  assert.throws(() => validateProposalArchive([{...entry,lpj:'javascript:alert(1)'}]), /tidak valid/);
  assert.throws(() => validateProposalArchive([{...entry,fields:{...entry.fields,target:42}}]), /Teks bagian/);
});

test('archive generation keeps the existing submission marker and bypasses AI', () => {
  const edge = fs.readFileSync(require.resolve('../supabase/functions/program-document-assistant/index.ts'),'utf8');
  const drive = fs.readFileSync(require.resolve('../supabase/functions/drive-integration/index.ts'),'utf8');
  assert.match(edge, /if\(archiveSections\)return json/);
  assert.match(edge, /if\(!archiveSections&&\(!doc\.ai_content/);
  assert.match(edge, /model:"archive", sections:archiveSections/);
  assert.match(drive, /data\.archive_sections[\s\S]*source\.schedule_section/);
});
