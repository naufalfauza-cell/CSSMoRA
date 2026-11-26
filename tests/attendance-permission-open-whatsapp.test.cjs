const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../dist/admin.js'), 'utf8');
const start = source.indexOf("attendanceRejectForm.addEventListener('submit'");
const end = source.indexOf('async function loadAttendancePermissions', start);

function setup({ hasWhatsapp = true, blocked = false } = {}) {
  const calls = [];
  let onSubmit;
  let finish;
  let fail;
  const saved = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const url = 'https://wa.me/6281234567890?text=izin';
  const chat = { closed: false, opener: {}, close: () => calls.push('close'), location: { replace: value => calls.push(value) } };
  vm.runInNewContext(source.slice(start, end), {
    isSecretariatAdmin: true,
    attendanceRejectConfirm: { disabled: false },
    attendanceRejectCancel: {},
    attendanceRejectDialog: { close: () => calls.push('dialog closed') },
    attendanceRejectReason: { value: 'other' },
    attendanceRejectNote: { value: '  Bukti buram.  ' },
    attendanceRejectForm: { dataset: { permissionId: 'record', hasWhatsapp: String(hasWhatsapp) }, addEventListener: (_, callback) => { onSubmit = callback; } },
    api: (_, { body }) => {
      assert.equal(body.p_permission_id, 'record');
      assert.equal(body.p_note, 'Bukti buram.');
      calls.push('save');
      return saved;
    },
    window: { open: () => { calls.push('open'); return blocked ? null : chat; } },
    loadAttendancePermissions: async id => { assert.equal(id, 'record'); return { id }; },
    attendanceRejectionWhatsAppUrl: () => hasWhatsapp ? url : '',
    showMessage: (_, message) => calls.push(message)
  });
  return { calls, chat, url, finish, fail, submit: () => onSubmit({ preventDefault() {} }) };
}

test('chat dibuka setelah keputusan tersimpan', async () => {
  const run = setup();
  const result = run.submit();
  assert.deepEqual(run.calls, ['open', 'save']);
  assert.equal(run.chat.opener, null);
  run.finish();
  await result;
  assert.deepEqual(run.calls, ['open', 'save', 'dialog closed', run.url]);
});

test('keputusan gagal menutup tab kosong dan popup terblokir memakai tautan yang tersedia', async () => {
  const failure = setup();
  const failed = failure.submit();
  failure.fail(new Error('gagal menyimpan'));
  await failed;
  assert.deepEqual(failure.calls, ['open', 'save', 'close', 'gagal menyimpan']);
  const blocked = setup({ blocked: true });
  const result = blocked.submit();
  blocked.finish();
  await result;
  assert.match(blocked.calls.at(-1), /Gunakan tombol Buka WhatsApp/);
  const legacy = setup({ hasWhatsapp: false });
  const withoutNumber = legacy.submit();
  legacy.finish();
  await withoutNumber;
  assert.deepEqual(legacy.calls, ['save', 'dialog closed']);
});
