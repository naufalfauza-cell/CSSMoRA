const config = window.CSSMORA_SUPABASE;
const $ = selector => document.querySelector(selector);
const form = $("#checkin-form");
const eventSelect = $("#event-select");
const eventLabel = $("#event-picker-label");
const statusMessage = $("#checkin-message");
const directToken = new URLSearchParams(location.search).get("t");
let activeEvents = [];
let selectedEvent = null;
let refreshTimer = null;
let loadingOptions = false;
const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]));
function setMessage(text, kind = "") {
  statusMessage.textContent = text;
  statusMessage.dataset.kind = kind;
}
function apiUrl(params = {}) {
  const url = new URL(config.url + "/functions/v1/attendance-checkin");
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null) url.searchParams.set(key, String(value)); });
  return url;
}
async function request(method, params = {}, body) {
  const url = apiUrl(params);
  const response = await fetch(url, {
    method,
    headers: { apikey: config.publishableKey, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Permintaan absensi gagal.");
  return result;
}
function fillSelect(node, items, placeholder, valueOf = item => item, labelOf = item => item) {
  node.innerHTML = '<option value="">' + escapeHTML(placeholder) + '</option>' + items.map(item =>
    '<option value="' + escapeHTML(valueOf(item)) + '">' + escapeHTML(labelOf(item)) + '</option>'
  ).join("");
}
function resetMemberFields() {
  const cohort = $("#checkin-cohort");
  const program = $("#checkin-program");
  const member = $("#checkin-member");
  cohort.disabled = true;
  program.disabled = true;
  member.disabled = true;
  fillSelect(cohort, [], "Pilih angkatan");
  fillSelect(program, [], "Pilih prodi");
  fillSelect(member, [], "Pilih nama");
  $("#checkin-code").value = "";
}
function hideCheckin(message, kind = "") {
  form.hidden = true;
  eventSelect.hidden = true;
  eventLabel.hidden = true;
  $("#event-meta").textContent = "";
  setMessage(message, kind);
}
async function loadRosterOptions(level, extra = {}) {
  if (!selectedEvent) return [];
  const data = await request("GET", { mode: "options", level, token: selectedEvent.public_token, ...extra });
  return Array.isArray(data.items) ? data.items : [];
}
async function chooseEvent(token) {
  selectedEvent = activeEvents.find(item => item.public_token === token) || null;
  resetMemberFields();
  if (!selectedEvent) {
    hideCheckin("Pilih kegiatan aktif untuk melanjutkan.");
    return;
  }
  $("#event-meta").textContent = selectedEvent.title + " · " + selectedEvent.event_date + " · " + (selectedEvent.session_name || "Umum") + " · WIB";
  form.hidden = false;
  setMessage("Pilih angkatan, prodi, dan nama anggota.", "");
  try {
    const cohorts = await loadRosterOptions("cohorts");
    if (!selectedEvent || selectedEvent.public_token !== token) return;
    fillSelect($("#checkin-cohort"), cohorts, "Pilih angkatan");
    $("#checkin-cohort").disabled = false;
    if (!cohorts.length) setMessage("Tidak ada anggota yang belum tercatat pada kegiatan ini.", "");
  } catch (error) {
    setMessage(error.message, "error");
  }
}
function renderEventPicker(preferredToken) {
  if (activeEvents.length > 1 && !directToken) {
    eventLabel.hidden = false;
    eventSelect.hidden = false;
    fillSelect(eventSelect, activeEvents, "Pilih kegiatan aktif", event => event.public_token, event => event.title + (event.session_name ? " · " + event.session_name : ""));
    const preferred = activeEvents.find(event => event.public_token === preferredToken);
    if (preferred) eventSelect.value = preferred.public_token;
  } else {
    eventLabel.hidden = true;
    eventSelect.hidden = true;
  }
}
async function refreshActiveEvents(silent = false) {
  if (loadingOptions || !config?.url || !config?.publishableKey) return;
  loadingOptions = true;
  try {
    const result = await request("GET", { mode: "active" });
    const fresh = Array.isArray(result.events) ? result.events : [];
    activeEvents = fresh;
    if (!fresh.length || (directToken && !fresh.some(event => event.public_token === directToken))) {
      selectedEvent = null;
      resetMemberFields();
      hideCheckin(directToken ? "Kegiatan ini belum aktif atau sudah ditutup." : "Belum ada kegiatan absensi aktif. Absensi akan muncul setelah pengurus membuka kegiatan hari ini.");
      return;
    }
    const currentToken = selectedEvent?.public_token || eventSelect.value;
    const nextToken = directToken || (fresh.some(event => event.public_token === currentToken) ? currentToken : fresh.length === 1 ? fresh[0].public_token : "");
    renderEventPicker(nextToken);
    if (nextToken) {
      if (selectedEvent?.public_token !== nextToken) await chooseEvent(nextToken);
    } else {
      selectedEvent = null;
      resetMemberFields();
      form.hidden = true;
      setMessage("Pilih kegiatan aktif untuk mulai absen.", "");
    }
  } catch (error) {
    if (!silent || !activeEvents.length) hideCheckin(error.message, "error");
  } finally {
    loadingOptions = false;
  }
}
eventSelect.addEventListener("change", () => { void chooseEvent(eventSelect.value); });
$("#checkin-cohort").addEventListener("change", async event => {
  const cohort = event.target.value;
  const program = $("#checkin-program");
  const member = $("#checkin-member");
  fillSelect(program, [], "Memuat prodi…");
  fillSelect(member, [], "Pilih nama");
  program.disabled = true;
  member.disabled = true;
  if (!cohort) { fillSelect(program, [], "Pilih prodi"); return; }
  try {
    const items = await loadRosterOptions("programs", { cohort });
    fillSelect(program, items, items.length ? "Pilih prodi" : "Prodi tidak tersedia");
    program.disabled = false;
  } catch (error) { setMessage(error.message, "error"); }
});
$("#checkin-program").addEventListener("change", async event => {
  const cohort = $("#checkin-cohort").value;
  const studyProgram = event.target.value;
  const member = $("#checkin-member");
  fillSelect(member, [], "Memuat nama…");
  member.disabled = true;
  if (!cohort || !studyProgram) { fillSelect(member, [], "Pilih nama"); return; }
  try {
    const items = await loadRosterOptions("members", { cohort, study_program: studyProgram });
    fillSelect(member, items, items.length ? "Pilih nama" : "Tidak ada nama", item => item.id, item => item.full_name);
    member.disabled = false;
    if (!items.length) setMessage("Tidak ada anggota yang belum tercatat untuk pilihan ini.", "");
  } catch (error) { setMessage(error.message, "error"); }
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!selectedEvent) return;
  const button = $("#checkin-submit");
  button.disabled = true;
  setMessage("Menyimpan kehadiran…");
  try {
    const result = await request("POST", { token: selectedEvent.public_token }, {
      cohort: $("#checkin-cohort").value,
      study_program: $("#checkin-program").value,
      member_id: $("#checkin-member").value,
      checkin_code: $("#checkin-code").value.trim()
    });
    form.hidden = true;
    setMessage(result.message || "Absensi berhasil dicatat.", "success");
  } catch (error) {
    setMessage(error.message, "error");
    button.disabled = false;
  }
});
if (config?.url && config?.publishableKey) {
  void refreshActiveEvents();
  refreshTimer = window.setInterval(() => void refreshActiveEvents(true), 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshActiveEvents(true); });
} else {
  hideCheckin("Layanan absensi belum siap. Coba muat ulang halaman.", "error");
}
