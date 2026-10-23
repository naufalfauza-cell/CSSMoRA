const config = window.CSSMORA_SUPABASE;
const $ = selector => document.querySelector(selector);
const recoveryForm = $('#recovery-form');
const passwordForm = $('#password-form');
let recoveryToken = null;

function message(text, kind = '') {
  const node = $('#password-message');
  node.textContent = text;
  node.dataset.kind = kind;
}

async function request(path, options = {}) {
  const response = await window.cssmoraFetch(`${config.url}/auth/v1/${path}`, {
    ...options,
    headers: { apikey: config.publishableKey, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || 'Permintaan gagal. Coba lagi.');
  return data;
}

function useRecoveryLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const type = params.get('type');
  const token = params.get('access_token');
  const error = params.get('error_description') || params.get('error');
  if (token && ['recovery', 'invite', 'signup'].includes(type)) {
    recoveryToken = token;
    recoveryForm.hidden = true;
    passwordForm.hidden = false;
    $('#password-title').textContent = 'Buat kata sandi';
    $('#password-help').textContent = 'Gunakan minimal 8 karakter untuk kata sandi akun admin CSSMoRA.';
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return;
  }
  if (error) {
    const expired = /expired|invalid/i.test(error);
    message(expired ? 'Tautan ini sudah kedaluwarsa atau pernah digunakan. Minta tautan baru di bawah.' : 'Tautan tidak dapat digunakan. Minta tautan baru di bawah.', 'error');
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
}

recoveryForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#recovery-submit');
  button.disabled = true;
  message('Mengirim tautan…');
  try {
    const email = recoveryForm.elements.email.value.trim().toLowerCase();
    const redirectTo = `${location.origin}${location.pathname}`;
    await request(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST', body: JSON.stringify({ email })
    });
    message('Jika email terdaftar, tautan untuk mengatur kata sandi akan segera dikirim. Cek inbox dan folder spam.', 'success');
  } catch (error) {
    message(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

passwordForm.addEventListener('submit', async event => {
  event.preventDefault();
  const password = passwordForm.elements.password.value;
  const confirmation = passwordForm.elements.confirmPassword.value;
  if (password !== confirmation) {
    message('Kedua kata sandi belum sama.', 'error');
    return;
  }
  const button = $('#password-submit');
  button.disabled = true;
  message('Menyimpan kata sandi…');
  try {
    await request('user', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${recoveryToken}` },
      body: JSON.stringify({ password })
    });
    recoveryToken = null;
    passwordForm.reset();
    passwordForm.hidden = true;
    $('#password-title').textContent = 'Kata sandi tersimpan';
    $('#password-help').textContent = 'Kamu sekarang bisa masuk ke panel admin CSSMoRA.';
    $('#login-link').textContent = 'Masuk ke panel admin';
    message('Kata sandi berhasil dibuat. Silakan login.', 'success');
  } catch (error) {
    message(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

useRecoveryLink();
