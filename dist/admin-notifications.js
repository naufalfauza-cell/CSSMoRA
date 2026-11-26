(() => {
  const $ = id => document.getElementById(id);
  const center = $('admin-notifications');
  const list = $('admin-notification-list');
  const badge = $('admin-notification-count');
  const markAll = $('admin-notification-read-all');
  const status = $('admin-notification-status');
  const summary = center.querySelector('summary');
  const formatDate = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'
  });
  let account;
  let entries = [];
  let read = new Set();
  let loading;
  let failed = false;

  function notificationSources(user, since) {
    const sources = [];
    const signatures = 'id,status,created_at,submitted_at,signed_at,rejected_at,secretariat_letters(letter_number,subject)';
    const funding = 'id,competition_name,status,created_at,treasurer_reviewed_at,chair_reviewed_at';
    function source(table, select, filter, order, map) {
      sources.push({
        path: table + '?' + new URLSearchParams({ select, ...filter, order, limit: '100' }),
        map
      });
    }
    const letter = (row, title, date) => ({
      id: 'signature:' + row.id + ':' + row.status, title,
      detail: [row.secretariat_letters?.letter_number, row.secretariat_letters?.subject].filter(Boolean).join(' · '),
      date, destination: 'signature'
    });
    const application = (row, title, date) => ({
      id: 'funding:' + row.id + ':' + row.status, title, detail: row.competition_name,
      date, destination: 'funding'
    });

    if (user.isLeadership || user.isSecretariatAdmin) {
      source('cssmora_letter_signature_requests', signatures, {
        status: 'eq.pending', signer_id: 'eq.' + user.userId
      }, 'submitted_at.desc.nullslast,created_at.desc', row => letter(row, 'Surat perlu ditandatangani', row.submitted_at || row.created_at));
    }
    if (user.isSecretariatAdmin) {
      source('cssmora_letter_signature_requests', signatures, {
        created_by: 'eq.' + user.userId,
        signed_by: 'neq.' + user.userId,
        signed_at: 'gte.' + since
      }, 'signed_at.desc', row => letter(row, 'Surat sudah ditandatangani', row.signed_at));
      source('cssmora_letter_signature_requests', signatures, {
        created_by: 'eq.' + user.userId, rejected_at: 'gte.' + since
      }, 'rejected_at.desc', row => letter(row, 'Pengajuan tanda tangan ditolak', row.rejected_at));
      source('secretariat_attendance_permissions', 'id,agenda_title,created_at,secretariat_members(full_name)', {
        approved_at: 'is.null', rejected_at: 'is.null', review_archived_at: 'is.null'
      }, 'created_at.desc', row => ({
        id: 'permission:' + row.id, title: 'Izin anggota perlu ditinjau',
        detail: [row.secretariat_members?.full_name, row.agenda_title].filter(Boolean).join(' · '),
        date: row.created_at, destination: 'permission'
      }));
    }
    if (user.achievementRole === 'bendahara') {
      source('cssmora_achievement_applications', funding, { status: 'eq.pending_bendahara' },
        'created_at.desc', row => application(row, 'Pengajuan bantuan lomba baru', row.created_at));
      source('cssmora_achievement_applications', funding, { status: 'eq.approved', payment_shared_at: 'is.null' },
        'chair_reviewed_at.desc.nullslast,created_at.desc', row => application(row, 'Bantuan lomba perlu ditindaklanjuti', row.chair_reviewed_at || row.created_at));
    }
    if (user.achievementRole === 'ketua') {
      source('cssmora_achievement_applications', funding, { status: 'eq.pending_ketua' },
        'treasurer_reviewed_at.desc.nullslast,created_at.desc', row => application(row, 'Bantuan lomba menunggu keputusan Ketua', row.treasurer_reviewed_at || row.created_at));
    }
    return sources;
  }

  const storageKey = user => 'cssmora-notifications-read:' + user.userId;
  function setRead(ids) {
    ids.forEach(id => read.add(id));
    try { localStorage.setItem(storageKey(account), JSON.stringify([...read].slice(-1000))); } catch {}
    render();
  }
  function openDestination(destination) {
    if (destination === 'funding') {
      $('tab-achievements').click();
      $('tab-achievement-applications').click();
      return;
    }
    $('tab-secretariat').click();
    if (destination === 'signature') {
      $('tab-letters').click();
      $('tab-letter-signatures').click();
    } else {
      $('tab-attendance-tools').click();
      $('attendance-permissions').open = true;
    }
  }

  function render() {
    const unread = entries.filter(entry => !read.has(entry.id)).length;
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    summary.setAttribute('aria-label', unread ? 'Notifikasi pengurus, ' + unread + ' belum dibaca' : 'Notifikasi pengurus');
    markAll.disabled = !unread;
    status.textContent = failed ? 'Sebagian notifikasi belum dapat dimuat. Buka kembali untuk mencoba lagi.'
      : entries.length ? '' : loading ? 'Memuat notifikasi…' : 'Belum ada notifikasi.';
    list.replaceChildren(...entries.map(entry => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = read.has(entry.id) ? '' : 'is-unread';
      const title = document.createElement('strong');
      title.textContent = entry.title;
      const detail = document.createElement('span');
      detail.textContent = entry.detail;
      const date = document.createElement('small');
      if (Number.isFinite(Date.parse(entry.date))) date.textContent = formatDate.format(new Date(entry.date)) + ' WIB';
      button.append(title, detail, date);
      button.addEventListener('click', () => {
        setRead([entry.id]);
        center.open = false;
        openDestination(entry.destination);
      });
      item.append(button);
      return item;
    }));
  }

  let previous = [];
  function refresh() {
    if (!account || document.hidden || loading) return;
    const user = account;
    const since = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
    const sources = notificationSources(user, since);
    loading = Promise.allSettled(sources.map(async source => {
      const rows = await window.CSSMoRAAdmin.api(source.path);
      return (rows || []).map(source.map);
    })).then(results => {
      if (account !== user) return;
      // Preserve the last successful result for each source during a temporary error.
      previous = results.map((result, index) => result.status === 'fulfilled' ? result.value : previous[index] || []);
      entries = previous.flat().sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      failed = results.some(result => result.status === 'rejected');
      loading = null;
      render();
    });
    if (center.open) render();
  }

  function reset() {
    account = null;
    entries = [];
    read = new Set();
    previous = [];
    loading = null;
    failed = false;
    center.open = false;
    render();
  }

  function start(user) {
    reset();
    account = user;
    try { read = new Set(JSON.parse(localStorage.getItem(storageKey(user)) || '[]')); } catch {}
    refresh();
  }
  center.addEventListener('toggle', () => { if (center.open) refresh(); });
  markAll.addEventListener('click', () => setRead(entries.map(entry => entry.id)));
  document.addEventListener('click', event => { if (center.open && !center.contains(event.target)) center.open = false; });
  center.addEventListener('keydown', event => {
    if (event.key === 'Escape' && center.open) {
      center.open = false;
      summary.focus();
    }
  });
  document.addEventListener('visibilitychange', refresh);
  window.setInterval(refresh, 60000);
  window.CSSMoRAAdminNotifications = { start, reset };
})();
