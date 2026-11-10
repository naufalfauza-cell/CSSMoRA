const { test } = require('node:test');
const assert = require('node:assert/strict');

test('masters with an embedded appendix require at least one attachment', async () => {
  const { letterTemplates } = await import('../supabase/functions/drive-integration/letter-templates.ts');
  assert.deepEqual(
    letterTemplates.filter(template => template.minimumAttachments > 0).map(template => template.key),
    ['wisuda', 'undangan-instansi', 'undangan-umum']
  );
  assert.ok(letterTemplates.filter(template => template.code === 'SU').every(template => template.identityFields.length === 2));
});

test('the chosen identity replaces the printed label and rejects mismatched prefixes', async () => {
  const { normalizeLetterIdentity, letterIdentityToken } = await import('../supabase/functions/drive-integration/letter-templates.ts');
  assert.equal(normalizeLetterIdentity('NIA. C0924001', 'NIA'), 'C0924001');
  assert.equal(normalizeLetterIdentity('NIM 042410000001', 'NIA'), null);
  assert.equal(normalizeLetterIdentity('NIM: 042410000001', 'NIM'), '042410000001');
  assert.equal(letterIdentityToken('SU', 'identitas_ketua_pelaksana'), 'NIA. {{identitas_ketua_pelaksana}}');
});

test('letter layout edits preserve the appendix paragraph and only bold the recipient block', async () => {
  const { letterLayoutRequests } = await import('../supabase/functions/drive-integration/letter-templates.ts');
  let index=1;
  const lines=['Yang Terhormat\n','{{nama_penerima}}\n','{{instansi_penerima}}\n','di-\n','Tempat\n',
    'Kami mengundang {{nama_penerima}}\n','Lampiran surat nomor: {{nomor_surat}}\n','RUNDOWN ACARA\n'];
  const content=lines.map(line=>{
    const startIndex=index;
    index+=line.length;
    return {startIndex,endIndex:index,paragraph:{elements:[{textRun:{content:line}}]}};
  });
  const requests=letterLayoutRequests(content);
  assert.deepEqual(requests.filter(x=>x.updateTextStyle).map(x=>x.updateTextStyle.range.startIndex), [content[2].startIndex,content[1].startIndex]);
  assert.deepEqual(requests[0].deleteContentRange.range,{startIndex:content[6].startIndex,endIndex:content[6].endIndex-1});
  assert.deepEqual(requests[2].insertText,{location:{index:content[3].startIndex+2},text:' '});
});
