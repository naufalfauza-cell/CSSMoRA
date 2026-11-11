const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../dist/program-documents.js'), 'utf8');
const functionSource = name => {
  const start = source.indexOf('  async function ' + name + '(');
  const end = source.indexOf('\n  }', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + 4);
};

test('a late response for an earlier proposal does not apply its details', async () => {
  const state = {selectionVersion: 2, detailsReady: false, financeReviewer: () => false, api: () => async () => []};
  vm.runInNewContext(functionSource('loadSubrecords'), state);
  await state.loadSubrecords({id: 'older', document_type: 'proposal'}, 1);
  assert.equal(state.detailsReady, false);
});

test('the editor prevents overlapping saves and unlocks after failure', async () => {
  const form = {inert: false};
  const state = {editorBusy: false, detailsReady: true, $: () => form, renderActions() {}};
  vm.runInNewContext(functionSource('runEditorTask'), state);
  let fail;
  const pending = state.runEditorTask(() => new Promise((_, reject) => { fail = reject; }));
  assert.equal(form.inert, true);
  await state.runEditorTask(() => assert.fail('overlapping task ran'));
  fail(new Error('network'));
  await assert.rejects(pending, /network/);
  assert.equal(form.inert, false);
  assert.equal(state.editorBusy, false);
});
