(() => {
  const entry = document.getElementById("attendance-entry");
  const config = window.CSSMORA_SUPABASE;
  if (!entry) return;
  const renumber = () => {
    document.querySelectorAll(".sign-nav .sign-link:not([hidden]) .sign-number").forEach((node, index) => {
      node.textContent = String(index + 1).padStart(2, "0");
    });
  };
  renumber();
  const meta = document.getElementById("attendance-entry-meta");
  if (!config?.url || !config?.publishableKey) {
    if (meta) meta.textContent = "CEK STATUS";
    return;
  }
  async function refreshAttendanceEntry() {
    try {
      const response = await fetch(config.url + "/functions/v1/attendance-checkin?mode=active", {
        headers: { apikey: config.publishableKey }
      });
      if (!response.ok) {
        if (meta) meta.textContent = "CEK STATUS";
        return;
      }
      const result = await response.json();
      const active = Array.isArray(result.events) && result.events.length > 0;
      if (meta) meta.textContent = active
        ? (result.events.length === 1 ? "KEGIATAN AKTIF" : result.events.length + " KEGIATAN AKTIF")
        : "BELUM ADA KEGIATAN";
      renumber();
    } catch {
      if (meta) meta.textContent = "CEK STATUS";
      renumber();
    }
  }
  refreshAttendanceEntry();
  window.setInterval(refreshAttendanceEntry, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAttendanceEntry(); });
})();