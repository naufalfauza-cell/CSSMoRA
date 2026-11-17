const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const js=fs.readFileSync('dist/admin.js','utf8');
const html=fs.readFileSync('dist/admin.html','utf8');
test('competition labels distinguish open, closed, hidden and drafts at 72-hour boundary',()=>{
 const start=js.indexOf('function competitionState('),end=js.indexOf('\nfunction renderRecords()',start);
 const state=vm.runInNewContext(js.slice(start,end)+'\ncompetitionState');
 const item={status:'published',deadline:'2026-11-13T16:59:00Z'};const due=Date.parse(item.deadline);
 assert.equal(state(item,due),'open');assert.equal(state(item,due+1),'closed');assert.equal(state(item,due+72*3600000),'closed');assert.equal(state(item,due+72*3600000+1),'expired');assert.equal(state({...item,status:'draft'},due),'draft');
});
test('program workspace provides grouped stages and clear entry to documents',()=>{
 for(const x of ['2 · Persiapan sebelum proposal','3 · Proposal','4 · Pelaksanaan dan evaluasi','5 · LPJ','program-document-guidance','program-document-choose-cycle','competition-record-search','competition-record-status'])assert.ok(html.includes(x),x);
 const documents=fs.readFileSync('dist/program-documents.js','utf8');assert.match(documents,/form'\)\.hidden=!hasDocument/);
});
