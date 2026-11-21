const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../dist', name), 'utf8');

test('camera and gallery have separate pickers and share photo preparation', async () => {
  const html = read('absen.html');
  const picker = id => html.match(new RegExp('<input id="' + id + '"[^>]+>'))?.[0];
  assert.match(picker('checkin-camera'), /capture="environment"/);
  assert.doesNotMatch(picker('checkin-photo'), /\bcapture\b/);
  assert.match(html, /type="button" data-photo-input="checkin-camera"/);
  assert.match(html, /type="button" data-photo-input="checkin-photo"/);

  const makeControl = () => ({
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    click() { this.clicked = true; }
  });
  const ids = ['checkin-camera', 'checkin-photo'];
  const inputs = Object.fromEntries(ids.map(id => ['#' + id, makeControl()]));
  const buttons = ids.map(id => ({ ...makeControl(), dataset: { photoInput: id } }));
  const photoFields = { querySelectorAll: () => buttons };
  const compressed = [];
  const preview = { hidden: true };
  const client = read('absen.js');
  const handlers = client.slice(client.indexOf('for (const button of photoFields'), client.indexOf('form.addEventListener("submit"'));
  const context = vm.createContext({
    $: selector => inputs[selector],
    photoFields,
    photoInputs: Object.values(inputs),
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

  for (const [index, id] of ids.entries()) {
    const input = inputs['#' + id];
    buttons[index].listeners.click();
    assert.equal(input.clicked, true);
    input.files = [{ name: id + '.jpg' }];
    await input.listeners.change({ currentTarget: input });
    assert.equal(preview.hidden, false);
    assert.equal(photoFields.disabled, false);
  }
  const gallery = inputs['#checkin-photo'];
  gallery.files = [];
  await gallery.listeners.change({ currentTarget: gallery });
  assert.equal(preview.hidden, false);
  assert.deepEqual(compressed.map(file => file.name), ids.map(id => id + '.jpg'));
});
