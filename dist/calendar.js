(() => {
  const dialog = document.getElementById('calendar-dialog');
  const cfg = window.CSSMORA_SUPABASE;
  if (!dialog || !cfg) return;

  const tz = 'Asia/Jakarta';
  const grid = document.getElementById('calendar-grid');
  const monthLabel = document.getElementById('calendar-month');
  const todayLabel = document.getElementById('calendar-today');
  const selectedLabel = document.getElementById('calendar-selected-date');
  const countdown = document.getElementById('calendar-countdown');
  const eventsBox = document.getElementById('calendar-events');
  const monthFmt = new Intl.DateTimeFormat('id-ID', {timeZone: tz, month: 'long', year: 'numeric'});
  const longDate = new Intl.DateTimeFormat('id-ID', {timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
  const dayKey = date => new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
  const keyOf = (year, month, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const dateFromKey = key => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12));
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const dayDiff = (from, to) => Math.round((dateFromKey(to) - dateFromKey(from)) / 86400000);
  const time = value => new Intl.DateTimeFormat('id-ID', {timeZone: tz, hour: '2-digit', minute: '2-digit'}).format(new Date(value)).replace(':', '.');
  const dateText = key => longDate.format(dateFromKey(key));
  const today = dayKey(new Date());
  const [todayYear, todayMonth] = today.split('-').map(Number);
  let viewYear = todayYear;
  let viewMonth = todayMonth - 1;
  let selected = today;
  let events = [];
  let eventsLoaded = false;
  let eventsPromise = null;

  const getEvents = () => {
    if (eventsLoaded) return Promise.resolve(events);
    if (eventsPromise) return eventsPromise;
    const query = new URLSearchParams({
      select: 'id,title,starts_at,ends_at,location,description',
      status: 'eq.published',
      order: 'starts_at.asc',
      limit: '1000'
    });
    eventsPromise = fetch(`${cfg.url}/rest/v1/agenda?${query}`, {
      headers: {apikey: cfg.publishableKey, Authorization: `Bearer ${cfg.publishableKey}`}
    }).then(response => {
      if (!response.ok) throw new Error(`Agenda request failed (${response.status})`);
      return response.json();
    }).then(rows => {
      events = Array.isArray(rows) ? rows : [];
      eventsLoaded = true;
      return events;
    }).catch(error => {
      eventsPromise = null;
      throw error;
    });
    return eventsPromise;
  };

  const eventsFor = key => events.filter(event => {
    const start = dayKey(new Date(event.starts_at));
    const end = event.ends_at ? dayKey(new Date(event.ends_at)) : start;
    return start <= key && end >= key;
  });
  const countdownText = key => {
    const delta = dayDiff(today, key);
    if (delta === 0) return 'Hari ini';
    if (delta > 0) return `H-${delta}`;
    return `Lewat ${Math.abs(delta)} hari`;
  };
  const eventCountdown = event => {
    const start = dayKey(new Date(event.starts_at));
    const end = event.ends_at ? dayKey(new Date(event.ends_at)) : start;
    if (start > today) return countdownText(start);
    if (end >= today) return 'Sedang berlangsung';
    return countdownText(start);
  };

  const renderDetails = () => {
    selectedLabel.textContent = dateText(selected);
    countdown.textContent = countdownText(selected);
    if (!eventsLoaded) {
      eventsBox.innerHTML = '<p class="calendar-message">Memuat agenda…</p>';
      return;
    }
    const items = eventsFor(selected);
    if (!items.length) {
      eventsBox.innerHTML = '<div class="calendar-empty"><span aria-hidden="true">✳</span><strong>Belum ada agenda</strong><p>Tanggal ini masih kosong. Agenda yang dipublikasikan akan muncul di sini.</p></div>';
      return;
    }
    eventsBox.innerHTML = items.map(event => {
      const start = new Date(event.starts_at);
      const end = event.ends_at ? new Date(event.ends_at) : null;
      const startDay = dayKey(start), endDay = end ? dayKey(end) : startDay;
      const timing = startDay !== endDay
        ? `${dateText(startDay)} · ${time(event.starts_at)} — ${dateText(endDay)} · ${time(event.ends_at)} WIB`
        : `${time(event.starts_at)}${event.ends_at ? `–${time(event.ends_at)}` : ''} WIB`;
      return `<article class="calendar-event-card">
        <div class="calendar-event-top"><span class="calendar-event-time">${timing}</span><span class="calendar-event-countdown">${eventCountdown(event)}</span></div>
        <h4>${esc(event.title)}</h4>
        ${event.location ? `<p class="calendar-event-location">${esc(event.location)}</p>` : ''}
        ${event.description ? `<p class="calendar-event-description">${esc(event.description)}</p>` : ''}
      </article>`;
    }).join('');
  };

  const renderMonth = () => {
    const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    monthLabel.textContent = monthFmt.format(new Date(Date.UTC(viewYear, viewMonth, 15, 12)));
    todayLabel.textContent = `Hari ini · ${dateText(today)}`;
    const cells = [];
    for (let cell = 0; cell < 42; cell++) {
      const day = cell - firstWeekday + 1;
      if (day < 1 || day > daysInMonth) {
        cells.push('<span class="calendar-day calendar-day-outside" aria-hidden="true"></span>');
        continue;
      }
      const key = keyOf(viewYear, viewMonth, day);
      const count = eventsFor(key).length;
      const classes = ['calendar-day'];
      if (key === today) classes.push('is-today');
      if (key === selected) classes.push('is-selected');
      if (count) classes.push('has-agenda');
      cells.push(`<button class="${classes.join(' ')}" type="button" data-date="${key}" aria-label="${esc(dateText(key))}${count ? `, ${count} agenda` : ''}" aria-pressed="${key === selected}"><span>${day}</span>${count ? `<i aria-hidden="true"></i><small>${count}</small>` : ''}</button>`);
    }
    grid.innerHTML = cells.join('');
    grid.querySelectorAll('[data-date]').forEach(button => button.addEventListener('click', () => {
      selected = button.dataset.date;
      renderMonth();
      renderDetails();
    }));
    renderDetails();
  };

  const changeMonth = offset => {
    const next = new Date(Date.UTC(viewYear, viewMonth + offset, 1, 12));
    viewYear = next.getUTCFullYear();
    viewMonth = next.getUTCMonth();
    if (selected.slice(0, 7) !== `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`) selected = keyOf(viewYear, viewMonth, 1);
    renderMonth();
  };

  document.querySelector('[data-calendar-open]')?.addEventListener('click', () => {
    dialog.showModal();
    renderMonth();
    if (!eventsLoaded) {
      eventsBox.innerHTML = '<p class="calendar-message">Memuat agenda…</p>';
      getEvents().then(renderMonth).catch(() => {
        eventsBox.innerHTML = '<div class="calendar-empty"><strong>Agenda belum bisa dimuat</strong><p>Coba muat ulang data kalender.</p><button class="calendar-retry" type="button" data-calendar-retry>Coba lagi</button></div>';
      });
    }
  });
  document.getElementById('calendar-prev')?.addEventListener('click', () => changeMonth(-1));
  document.getElementById('calendar-next')?.addEventListener('click', () => changeMonth(1));
  document.getElementById('calendar-today-button')?.addEventListener('click', () => {
    viewYear = todayYear; viewMonth = todayMonth - 1; selected = today; renderMonth();
  });
  document.getElementById('calendar-close')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  eventsBox.addEventListener('click', event => {
    if (event.target.closest('[data-calendar-retry]')) {
      eventsBox.innerHTML = '<p class="calendar-message">Memuat agenda…</p>';
      getEvents().then(renderMonth).catch(() => {
        eventsBox.innerHTML = '<div class="calendar-empty"><strong>Agenda belum bisa dimuat</strong><p>Coba lagi beberapa saat.</p><button class="calendar-retry" type="button" data-calendar-retry>Coba lagi</button></div>';
      });
    }
  });
  renderMonth();
})();
