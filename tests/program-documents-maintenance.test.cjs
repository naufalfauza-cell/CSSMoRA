const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('dist/admin.html','utf8');
test('proposal and LPJ are hidden behind maintenance notices',()=>{
  assert.match(html,/Bagian proposal sedang dalam pemeliharaan[^<]*<\/p><div id="program-cycle-proposal" hidden>/);
  assert.match(html,/Bagian LPJ sedang dalam pemeliharaan[^<]*<\/p><div id="program-cycle-lpj" hidden>/);
  assert.match(html,/Sedang dalam pemeliharaan\. Proposal dan LPJ belum dapat diakses/);
  assert.match(html,/<div class="program-documents-layout" hidden>/);
});
