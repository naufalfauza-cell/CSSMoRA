const test = require('node:test');
const assert = require('node:assert/strict');

let storageModule;
test('Supabase Storage adapter keeps current upload and signed-url behavior behind one interface', async () => {
  storageModule = await import('../supabase/functions/_shared/storage-provider.mjs');
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    let body = {};
    if (String(url).includes('/object/upload/sign/')) body = { url: '/object/upload/sign/attendance-proofs/event-1/member-1/proof.jpg?token=opaque' };
    else if (String(url).includes('/object/sign/')) body = { signedURL: '/object/sign/attendance-proofs/event-1/member-1/proof.jpg?token=opaque' };
    else if (String(url).includes('/object/info/')) body = { size: 1024, contentType: 'image/jpeg', createdAt: '2026-10-23T08:00:00.000Z' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const storage = storageModule.createStorageProvider({
    baseUrl: 'https://project.supabase.co/',
    apiKey: 'test-secret',
    fetchImpl,
  });

  const upload = await storage.upload('cssmora-prestasi-proofs', 'applications/app-1/proof.pdf', new Uint8Array([1]), {
    contentType: 'application/pdf',
  });
  const signedRead = await storage.createSignedUrl('attendance-proofs', 'event-1/member-1/proof.jpg', 300);
  const signedUpload = await storage.createSignedUploadUrl('attendance-proofs', 'event-1/member-1/proof.jpg');
  const info = await storage.info('attendance-proofs', 'event-1/member-1/proof.jpg');
  await storage.removeMany('attendance-proofs', ['event-1/member-1/proof.jpg']);

  assert.equal(upload.ok, true);
  assert.equal(calls[0].url, 'https://project.supabase.co/storage/v1/object/cssmora-prestasi-proofs/applications/app-1/proof.pdf');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.apikey, 'test-secret');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-secret');
  assert.equal(calls[0].init.headers['x-upsert'], 'false');
  assert.equal(calls[1].url, 'https://project.supabase.co/storage/v1/object/sign/attendance-proofs/event-1/member-1/proof.jpg');
  assert.equal(calls[1].init.body, JSON.stringify({ expiresIn: 300 }));
  assert.equal(signedRead.url, 'https://project.supabase.co/storage/v1/object/sign/attendance-proofs/event-1/member-1/proof.jpg?token=opaque');
  assert.equal(calls[2].url, 'https://project.supabase.co/storage/v1/object/upload/sign/attendance-proofs/event-1/member-1/proof.jpg');
  assert.equal(signedUpload.url, 'https://project.supabase.co/storage/v1/object/upload/sign/attendance-proofs/event-1/member-1/proof.jpg?token=opaque');
  assert.equal(info.sizeBytes, 1024);
  assert.equal(info.contentType, 'image/jpeg');
  assert.equal(info.uploadedAt, '2026-10-23T08:00:00.000Z');
  assert.deepEqual(JSON.parse(calls[4].init.body), { prefixes: ['event-1/member-1/proof.jpg'] });
  assert.deepEqual(storage.reference('posters', 'competition-1/poster.jpg'), {
    provider: 'supabase', bucket: 'posters', path: 'competition-1/poster.jpg',
  });
});

test('Storage adapter rejects unknown providers, buckets, unsafe paths, and invalid URL lifetimes', async () => {
  const { createStorageProvider } = storageModule ?? await import('../supabase/functions/_shared/storage-provider.mjs');
  const storage = createStorageProvider({
    baseUrl: 'https://project.supabase.co',
    apiKey: 'test-secret',
    fetchImpl: async () => new Response('{}'),
  });
  assert.throws(() => createStorageProvider({ provider: 'google-drive', baseUrl: 'https://project.supabase.co', apiKey: 'test-secret' }), /belum dikonfigurasi/);
  await assert.rejects(storage.info('unknown-bucket', 'file.jpg'), /tidak diizinkan/);
  await assert.rejects(storage.info('attendance-proofs', '../private.jpg'), /tidak valid/);
  await assert.rejects(storage.createSignedUrl('attendance-proofs', 'file.jpg', 0), /tidak valid/);
});
