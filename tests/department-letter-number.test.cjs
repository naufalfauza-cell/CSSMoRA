const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../dist/admin.js'), 'utf8');

test('pengajuan tanda tangan memakai ID surat yang dipilih dan melepas PDF surat sebelumnya', async () => {
  const start = source.indexOf("$('#letter-record-list').addEventListener('click'");
  const end = source.indexOf("$('#letter-issued-on')", start);
  const calls = [];
  let click;
  const pdf = { value: 'surat-sebelumnya.pdf', focus: () => calls.push('pilih PDF') };
  const context = {
    isSecretariatAdmin: true,
    outgoingSignatureSelect: { value: 'surat-sebelumnya', disabled: false },
    preparedOutgoingLetterId: 'surat-sebelumnya',
    $: id => ({
      '#letter-record-list': { addEventListener: (_, callback) => { click = callback; } },
      '#letter-sign-pdf': pdf,
      '#tab-letter-signatures': { click: () => calls.push('buka pengajuan') }
    })[id]
  };
  vm.runInNewContext(source.slice(start, end), context);
  await click({ target: { closest: selector => selector === '[data-sign-letter]' && { dataset: { signLetter: 'surat-departemen' } } } });
  assert.equal(context.outgoingSignatureSelect.value, 'surat-departemen');
  assert.equal(pdf.value, '');
  assert.equal(context.preparedOutgoingLetterId, null);
  assert.deepEqual(calls, ['buka pengajuan', 'pilih PDF']);
});
