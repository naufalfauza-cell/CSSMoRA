const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

test('choosing a roster organizer fills the identity and switching NIM/NIA refreshes it', async () => {
  const source = readFileSync(join(__dirname, '../dist/admin.js'), 'utf8');
  const start = source.indexOf('async function connectOutgoingOrganizerFields');
  const end = source.indexOf('function showOutgoingTemplateFields', start);
  const element = () => ({
    isConnected: true, value: '', handlers: {}, setAttribute() {}, replaceChildren() {},
    addEventListener(event, handler) { this.handlers[event] = handler; },
  });
  const name = element(), number = element(), identity = element();
  const controls = {
    prepend() {},
    querySelector(selector) {
      return ({
        '#outgoing-field-nama_ketua_pelaksana': name,
        '#outgoing-field-identitas_ketua_pelaksana': number,
      })[selector];
    },
  };
  const connect = runInNewContext(source.slice(start, end) + '\nconnectOutgoingOrganizerFields', {
    document: { createElement: element },
    Option: class {},
    api: async () => [{ full_name: 'Contoh Anggota', nia: 'C0001', nim: '123456789' }],
  });
  await connect(controls, identity);
  identity.value = 'NIM';
  name.value = 'Contoh Anggota · C0001';
  name.handlers.input();
  assert.equal(name.value, 'Contoh Anggota');
  assert.equal(number.value, '123456789');
  assert.equal(number.readOnly, true);
  identity.value = 'NIA';
  identity.handlers.change();
  assert.equal(number.value, 'C0001');
  name.value = 'Nama lain';
  name.handlers.input();
  assert.equal(number.value, '');
  assert.equal(number.readOnly, false);
});
