const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../dist', name), 'utf8');

test('one native photo picker opens without forcing capture and keeps the preview on cancel', async () => {
  const html = read('absen.html');
  const field = html.match(/<fieldset[^>]+id="checkin-photo-fields"[^>]*>[\s\S]*?<\/fieldset>/)?.[0];
  assert.ok(field);
  const inputs = field.match(/<input[^>]+type="file"[^>]*>/g);
  assert.equal(inputs.length, 1);
  assert.match(inputs[0], /id="checkin-photo".*accept="image\/jpeg,image\/png,image\/webp"/);
  assert.doesNotMatch(inputs[0], /\bcapture\b/);
  assert.equal(field.match(/<button\b/g).length, 1);
  assert.match(field, /id="checkin-photo-picker" type="button">Pilih foto<\/button>/);

  const makeControl = () => ({
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    click() { this.clicked = true; }
  });
  const input = makeControl();
  const button = makeControl();
  const photoFields = {};
  const compressed = [];
  const preview = { hidden: true };
  const client = read('absen.js');
  const handlers = client.slice(client.indexOf('$("#checkin-photo-picker").addEventListener'), client.indexOf('form.addEventListener("submit"'));
  const context = vm.createContext({
    $: selector => { assert.equal(selector, "#checkin-photo-picker"); return button; },
    photoFields,
    photoInput: input,
    photoPreview: preview,
    photoPreviewImage: {},
    photoSize: {},
    processingPhoto: false,
    submitting: false,
    selectedEvent: {},
    modeVersion: 0,
    permissionMode: () => false,
    eventKey: () => 'pelantikan',
    setMessage() {},
    resetPhoto() { preview.hidden = true; },
    compressPhoto: async file => { compressed.push(file); return { size: 1024 }; },
    URL: { createObjectURL: () => 'blob:preview' }
  });
  vm.runInContext(handlers, context);

  button.listeners.click();
  assert.equal(input.clicked, true);
  input.files = [{ name: 'proof.jpg' }];
  await input.listeners.change({ currentTarget: input });
  assert.equal(preview.hidden, false);
  assert.equal(photoFields.disabled, false);
  input.files = [];
  await input.listeners.change({ currentTarget: input });
  assert.equal(preview.hidden, false);
  assert.deepEqual(compressed.map(file => file.name), ['proof.jpg']);
});
