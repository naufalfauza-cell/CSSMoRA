(() => {
  const current = window.location;
  const query = new URLSearchParams(current.search);
  const fragment = new URLSearchParams(current.hash.replace(/^#/, ''));
  const callbackTypes = new Set(['invite', 'recovery', 'signup']);
  const type = fragment.get('type') || query.get('type');

  // Supabase's default invite redirect can land on the public homepage. Move
  // auth callbacks to the existing password setup page before the dashboard renders.
  if (!callbackTypes.has(type)) return;
  if (/\/set-password\.html$/.test(current.pathname)) return;

  const target = new URL('/set-password.html', current.origin);
  target.search = current.search;
  target.hash = current.hash;
  current.replace(target.href);
})();