(() => {
  const labels = {
    planning: 'Rencana',
    ongoing: 'Berjalan',
    lpj_review: 'Menunggu persetujuan',
    revision: 'Perlu revisi',
    completed: 'Selesai'
  };
  const dateValue = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
  const daysUntil = (value, today) => {
    const date = dateValue(value);
    const base = dateValue(today);
    if (!date || !base) return null;
    return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86400000);
  };
  const progressPercent = milestones => {
    const rows = Array.isArray(milestones) ? milestones : [];
    return rows.length ? Math.round(rows.filter(row => row.status === 'completed').length * 100 / rows.length) : 0;
  };
  const reminderRows = (cycles, milestones, today) => {
    const rows = [];
    for (const cycle of Array.isArray(cycles) ? cycles : []) {
      if (cycle.status === 'completed') continue;
      if (cycle.lpj_due_date) {
        const days = daysUntil(cycle.lpj_due_date, today);
        if (days !== null && days <= 7) rows.push({ type: 'lpj', cycle_id: cycle.id, title: `${cycle.program_name || 'Proker'} · LPJ`, due_date: cycle.lpj_due_date, days, status: cycle.status });
      }
    }
    for (const milestone of Array.isArray(milestones) ? milestones : []) {
      if (milestone.status === 'completed') continue;
      const days = daysUntil(milestone.due_date, today);
      if (days !== null && days <= 7) rows.push({ type: 'milestone', cycle_id: milestone.cycle_id, title: milestone.title, program_name: milestone.program_name || '', due_date: milestone.due_date, days, status: milestone.status });
    }
    return rows.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title, 'id')).slice(0, 20);
  };
  const periodLabel = date => {
    const year = date.getFullYear();
    return date.getMonth() >= 6 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
  };
  window.CSSMoRAProgramWorkflowDomain = { labels, dateValue, daysUntil, progressPercent, reminderRows, periodLabel };
})();
