// Supabase publishable key can be used in browser; row access is restricted by RLS.
window.CSSMORA_SUPABASE = Object.freeze({
  url: 'https://xciouilzpxxfqvxsuyqg.supabase.co',
  publishableKey: 'sb_publishable_CCg_NYhlI6ER8H0eJvGzpQ_-4kcb5gf'
});

window.cssmoraFetch = async (input, init = {}, timeoutMs = 12000) => {
  if (typeof AbortController === 'undefined') return fetch(input, init);
  const controller = new AbortController();
  const externalSignal = init.signal;
  const timeout = Number.isFinite(Number(timeoutMs)) ? Math.max(1, Number(timeoutMs)) : 12000;
  let timedOut = false;
  let externalAbort;
  if (externalSignal) {
    externalAbort = () => controller.abort(externalSignal.reason);
    if (externalSignal.aborted) externalAbort();
    else externalSignal.addEventListener('abort', externalAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error('Layanan terlalu lama merespons. Periksa koneksi lalu coba lagi.');
    throw error;
  } finally {
    clearTimeout(timer);
    if (externalSignal && externalAbort) externalSignal.removeEventListener('abort', externalAbort);
  }
};
