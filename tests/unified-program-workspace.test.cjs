const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require.resolve('../dist/admin.html'), 'utf8');
const workflow = fs.readFileSync(require.resolve('../dist/program-workflow.js'), 'utf8');

test('one program workspace orders preparation, proposal, and LPJ', () => {
  assert.doesNotMatch(html, /id="tab-program-documents"/);
  assert.match(html, /id="program-workflow-panel"[\s\S]+id="program-prep-create"[\s\S]+id="program-cycle-proposal"[\s\S]+id="program-cycle-lpj"[\s\S]+id="program-documents-panel"/);
});

test('new proposals require a worksheet and new LPJs wait for the event date', () => {
  const elements = new Map();
  const sandbox = {
    currentCycle:{status:'ongoing', period_end:'2026-11-12'},
    $:key => {
      if(!elements.has(key))elements.set(key,{});
      return elements.get(key);
    },
    context:()=>({}),
    officialDocumentFor:()=>null,
    officialLpjFor:()=>null,
    officialLpjAvailable:true,
    escape:String,
    todayWib:()=> '2026-11-12'
  };
  const source = workflow.slice(workflow.indexOf('  function renderActions()'), workflow.indexOf('  const prepLinks'));
  const render = vm.runInNewContext(source+'\nrenderActions',sandbox);
  render();
  assert.doesNotMatch(elements.get('#program-cycle-proposal').innerHTML,/data-cycle-open-proposal/);
  assert.doesNotMatch(elements.get('#program-cycle-lpj').innerHTML,/data-cycle-open-lpj/);
  sandbox.currentCycle.prep_document_url='https://docs.google.com/document/d/example/edit';
  sandbox.todayWib=()=> '2026-11-13';
  render();
  assert.match(elements.get('#program-cycle-proposal').innerHTML,/data-cycle-open-proposal/);
  assert.match(elements.get('#program-cycle-lpj').innerHTML,/data-cycle-open-lpj/);
});
