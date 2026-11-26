const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const admin = readFileSync(require.resolve('../dist/admin.js'), 'utf8');
const edge = readFileSync('supabase/functions/attendance-checkin/index.ts', 'utf8');

test('WhatsApp lokal dan internasional dinormalisasi sebelum mengunggah surat', () => {
  const start = edge.indexOf('function normalizePermissionWhatsApp');
  const end = edge.indexOf('async function submitPermission', start);
  const script = edge.slice(start, end).replace(': FormDataEntryValue | null | undefined', '');
  const normalize = vm.runInNewContext(script + '\nnormalizePermissionWhatsApp');
  for (const number of ['0812 3456 7890', '+62 (812) 3456-7890', '006281234567890', '6281234567890']) {
    assert.equal(normalize(number), '6281234567890');
  }
  assert.equal(normalize('+61412345678'), '61412345678');
  for (const invalid of [null, '', '08123456', '0812contoh', '+081234567890', '+62081234567890']) {
    assert.equal(normalize(invalid), null);
  }
  assert.match(edge, /p_whatsapp_number: whatsappNumber/);
});

test('pesan WhatsApp memakai nomor dan alasan yang tersimpan dan tersedia untuk Sekretaris', () => {
  const start = admin.indexOf('function attendanceRejectionNotice');
  const end = admin.indexOf("attendanceRejectReason.addEventListener('change'", start);
  const context = {
    attendanceRejectReason: { options: [{ value: 'permission_limit', textContent: 'Melebihi batas izin' }] },
    isSecretariatAdmin: true,
    escapeHTML: s => String(s).replaceAll('<','&lt;')
  };
  vm.runInNewContext(admin.slice(start, end), context);
  const row = {
    rejected_at: '2026-11-26', whatsapp_number: '6281234567890',
    agenda_title: 'Sambut Maba & Diskusi', secretariat_members: { full_name: 'Anggota Uji' }
  };
  const notice = context.attendanceRejectionNotice({ ...row, rejection_reason_code: 'permission_limit' });
  const url = new URL(notice.match(/href="([^"]+)"/)[1]);
  assert.equal(url.origin + url.pathname, 'https://wa.me/6281234567890');
  assert.match(url.searchParams.get('text'), /Anggota Uji.*Sambut Maba & Diskusi.*ditolak.*Melebihi batas izin/s);
  assert.match(context.attendanceRejectionNotice({ ...row, rejection_reason_code: 'other', rejection_note: '<alasan>' }), /&lt;alasan>/);
  assert.doesNotMatch(context.attendanceRejectionNotice({ ...row, whatsapp_number: null }), /wa\.me/);
  assert.equal(context.attendanceRejectionNotice({ ...row, rejected_at: null }), '');
  context.isSecretariatAdmin = false;
  assert.doesNotMatch(context.attendanceRejectionNotice(row), /wa\.me/);
});
