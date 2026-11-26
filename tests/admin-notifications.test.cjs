const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const source = readFileSync(require.resolve('../dist/admin-notifications.js'), 'utf8');

function setup(storage = new Map(), fetchRows = () => []) {
  const paths = [];
  function node() {
    return {
      children: [], handlers: {}, attributes: {},
      querySelector: () => node(),
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute(key, value) { this.attributes[key] = value; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; }
    };
  }
  const nodes = new Map();
  const window = { setInterval() {}, CSSMoRAAdmin: { api: async path => {
    paths.push(new URL(path, 'https://local.invalid'));
    return fetchRows(paths.at(-1));
  } } };
  vm.runInNewContext(source, { window, URLSearchParams, localStorage: {
    getItem: key => storage.get(key),
    setItem: (key, value) => storage.set(key, value)
  }, document: {
    hidden: false,
    getElementById: id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    createElement: node, addEventListener() {}
  } });
  return { nodes, paths, center: window.CSSMoRAAdminNotifications };
}

test('sumber notifikasi hanya mengikuti peran dan surat yang ditugaskan', () => {
  const chair = setup();
  chair.center.start({ userId: 'chair', isLeadership: true, achievementRole: 'ketua' });
  assert.deepEqual(chair.paths.map(url => [url.pathname, url.searchParams.get('status')]), [
    ['/cssmora_letter_signature_requests', 'eq.pending'], ['/cssmora_achievement_applications', 'eq.pending_ketua']
  ]);
  assert.equal(chair.paths[0].searchParams.get('signer_id'), 'eq.chair');

  const secretary = setup();
  secretary.center.start({ userId: 'secretary', isSecretariatAdmin: true });
  assert.equal(secretary.paths.length, 4);
  assert.equal(secretary.paths[1].searchParams.get('created_by'), 'eq.secretary');
  assert.equal(secretary.paths[1].searchParams.get('signed_by'), 'neq.secretary');
  assert.equal(secretary.paths[3].searchParams.get('review_archived_at'), 'is.null');

  const treasurer = setup();
  treasurer.center.start({ userId: 'treasurer', achievementRole: 'bendahara' });
  assert.deepEqual(treasurer.paths.map(url => url.searchParams.get('status')), ['eq.pending_bendahara', 'eq.approved']);

  const department = setup();
  department.center.start({ userId: 'department' });
  assert.equal(department.paths.length, 0);
});

test('tanda dibaca tersimpan per akun dan bersih saat keluar', async () => {
  const app = setup(new Map(), url => url.searchParams.get('status') === 'eq.pending_bendahara'
    ? [{ id: 'app', status: 'pending_bendahara', competition_name: 'Lomba Uji', created_at: '2026-11-26T13:00:00Z' }] : []);
  const render = () => new Promise(resolve => setImmediate(resolve));
  const user = { userId: 'first', achievementRole: 'bendahara' };
  const badge = app.nodes.get('admin-notification-count');
  app.center.start(user);
  await render();
  assert.equal(badge.textContent, '1');
  app.nodes.get('admin-notification-read-all').handlers.click();
  assert.equal(badge.hidden, true);
  app.center.reset();
  assert.equal(app.nodes.get('admin-notification-list').children.length, 0);
  app.center.start(user);
  await render();
  assert.equal(badge.hidden, true);
  app.center.start({ ...user, userId: 'second' });
  await render();
  assert.equal(badge.hidden, false);
});
