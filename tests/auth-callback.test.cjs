const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '..');
const callbackScript = fs.readFileSync(path.join(root, 'dist/auth-callback.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');

function runCallback(url) {
  const parsed = new URL(url);
  let redirectedTo = null;
  const location = {
    origin: parsed.origin,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    href: parsed.href,
    replace(target) {
      redirectedTo = target;
    },
  };

  vm.runInNewContext(callbackScript, {
    URL,
    URLSearchParams,
    window: { location },
  });

  return redirectedTo;
}

test('public homepage sends Supabase invite tokens to password setup and preserves callback data', () => {
  const result = runCallback('https://cssmora.vercel.app/#access_token=fake-token&type=invite');
  assert.equal(result, 'https://cssmora.vercel.app/set-password.html#access_token=fake-token&type=invite');
});

test('password recovery callback query params are routed to the password page', () => {
  assert.equal(
    runCallback('https://cssmora.vercel.app/?type=recovery&state=fake-state'),
    'https://cssmora.vercel.app/set-password.html?type=recovery&state=fake-state'
  );
  assert.equal(runCallback('https://cssmora.vercel.app/?code=fake-code'), null);
});

test('ordinary homepage visits and password-page visits do not redirect', () => {
  assert.equal(runCallback('https://cssmora.vercel.app/'), null);
  assert.equal(runCallback('https://cssmora.vercel.app/set-password.html#type=invite'), null);
});

test('callback script loads synchronously in the public page head', () => {
  const scriptIndex = indexHtml.indexOf('src="./auth-callback.js?v=20261029-invite-callback"');
  assert.notEqual(scriptIndex, -1, 'auth callback handler should be included');
  assert.ok(scriptIndex < indexHtml.indexOf('</head>'), 'handler should run before the public page renders');
  assert.ok(!indexHtml.slice(Math.max(0, scriptIndex - 20), scriptIndex + 90).includes('defer'));
});