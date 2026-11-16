const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../dist/letter-signatures.js'),'utf8');
const queue = vm.runInNewContext('(requests,context) => {' + source.slice(source.indexOf('  function queueCards'),source.indexOf('  function renderQueue')) + 'return queueCards(requests,context)}');
const root={id:'root',letter_id:'004',signer_id:'secretary',status:'signed'};
const child={id:'child',letter_id:'004',signer_id:'chair',source_request_id:'root',status:'pending'};
test('secretary sees one card for both stages, while leadership sees only assigned requests',()=>{
  const deputy={id:'deputy',letter_id:'005',signer_id:'deputy',status:'pending'};
  const items=[deputy,child,root];
  const secretary=queue(items,{isSecretariatAdmin:true,userId:'secretary'});
  assert.equal(secretary.length,2);
  assert.equal(secretary[1].item,root);
  assert.equal(secretary[1].handoff,child);
  assert.equal(queue(items,{userId:'chair'}).length,1);
  assert.equal(queue(items,{userId:'chair'})[0].item,child);
  assert.equal(queue(items,{userId:'deputy'})[0].item,deputy);
});
test('active handoff is preferred to an unsuccessful attempt, and completed handoff stays on the same card',()=>{
  const complete={...child,status:'signed'};
  const cancelled={...child,id:'cancelled',status:'cancelled'};
  const cards=queue([cancelled,complete,root],{isSecretariatAdmin:true,userId:'secretary'});
  assert.equal(cards.length,1);
  assert.equal(cards[0].handoff,complete);
});
