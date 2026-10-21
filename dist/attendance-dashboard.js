(() => {
  const entry = document.getElementById("attendance-entry");
  const config = window.CSSMORA_SUPABASE;
  if (!entry || !config?.url || !config?.publishableKey) return;
  const renumber = () => {
    document.querySelectorAll(".sign-nav .sign-link:not([hidden]) .sign-number").forEach((node, index) => {
      node.textContent = String(index + 1).padStart(2, "0");
    });
  };
  let previousActive = false;
  async function refreshAttendanceEntry() {
    try {
      const response = await fetch(config.url + "/functions/v1/attendance-checkin?mode=active", {
        headers: { apikey: config.publishableKey }
      });
      if (!response.ok) return;
      const result = await response.json();
      const active = Array.isArray(result.events) && result.events.length > 0;
      entry.hidden = !active;
      previousActive = active;
      const meta = document.getElementById("attendance-entry-meta");
      if (meta && active) meta.textContent = result.events.length === 1 ? "KEGIATAN AKTIF" : result.events.length + " KEGIATAN AKTIF";
      renumber();
    } catch {
      if (!previousActive) entry.hidden = true;
      renumber();
    }
  }
  refreshAttendanceEntry();
  window.setInterval(refreshAttendanceEntry, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAttendanceEntry(); });
})();