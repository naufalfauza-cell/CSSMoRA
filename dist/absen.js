const config = window.CSSMORA_SUPABASE;
const $ = selector => document.querySelector(selector);
const form = $("#checkin-form");
const eventSelect = $("#event-select");
const eventLabel = $("#event-picker-label");
const statusMessage = $("#checkin-message");
const photoInput = $("#checkin-photo");
const photoPreview = $("#photo-preview");
const photoPreviewImage = $("#photo-preview-image");
const photoSize = $("#photo-size");
const MAX_PHOTO_BYTES = 512000;
let compressedPhoto = null;
let photoPreviewUrl = null;
const directToken = new URLSearchParams(location.search).get("t");
let activeEvents = [];
let selectedEvent = null;
let refreshTimer = null;
let loadingOptions = false;
let rosterOptionsRequest = 0;
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
  const response = await window.cssmoraFetch(url, {
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
  rosterOptionsRequest++;
  const cohort = $("#checkin-cohort");
  const program = $("#checkin-program");
  const member = $("#checkin-member");
  cohort.disabled = true;
  program.disabled = true;
  member.disabled = true;
  fillSelect(cohort, [], "Pilih angkatan");
  fillSelect(program, [], "Pilih prodi");
  fillSelect(member, [], "Pilih nama");
  resetPhoto();
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
  const requestId = ++rosterOptionsRequest;
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
    if (requestId !== rosterOptionsRequest) return;
    fillSelect(program, items, items.length ? "Pilih prodi" : "Prodi tidak tersedia");
    program.disabled = false;
  } catch (error) { if (requestId === rosterOptionsRequest) setMessage(error.message, "error"); }
});
$("#checkin-program").addEventListener("change", async event => {
  const requestId = ++rosterOptionsRequest;
  const cohort = $("#checkin-cohort").value;
  const studyProgram = event.target.value;
  const member = $("#checkin-member");
  fillSelect(member, [], "Memuat nama…");
  member.disabled = true;
  if (!cohort || !studyProgram) { fillSelect(member, [], "Pilih nama"); return; }
  try {
    const items = await loadRosterOptions("members", { cohort, study_program: studyProgram });
    if (requestId !== rosterOptionsRequest) return;
    fillSelect(member, items, items.length ? "Pilih nama" : "Tidak ada nama", item => item.id, item => item.full_name);
    member.disabled = false;
    if (!items.length) setMessage("Tidak ada anggota yang belum tercatat untuk pilihan ini.", "");
  } catch (error) { if (requestId === rosterOptionsRequest) setMessage(error.message, "error"); }
});
function resetPhoto() {
  compressedPhoto = null;
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = null;
  photoInput.value = "";
  photoPreviewImage.removeAttribute("src");
  photoSize.textContent = "";
  photoPreview.hidden = true;
}
async function decodePhoto(file) {
  if (typeof createImageBitmap === "function") return await createImageBitmap(file);
  return await new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Foto tidak dapat dibaca. Coba pilih JPG atau PNG.")); };
    image.src = objectUrl;
  });
}
function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Foto gagal dikompres. Coba foto lain.")), "image/jpeg", quality));
}
async function compressPhoto(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Pilih foto JPG, PNG, atau WebP.");
  }
  const bitmap = await decodePhoto(file);
  try {
    const maxEdges = [1600, 1400, 1200, 1000, 800];
    const qualities = [0.84, 0.78, 0.72, 0.66, 0.60, 0.54, 0.48];
    for (const maxEdge of maxEdges) {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Peramban tidak dapat memproses foto ini.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of qualities) {
        const blob = await canvasBlob(canvas, quality);
        if (blob.size <= MAX_PHOTO_BYTES) return blob;
      }
    }
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
  throw new Error("Foto belum bisa diperkecil sampai 500 KB. Coba foto lain dengan ukuran lebih kecil.");
}
photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  compressedPhoto = null;
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = null;
  photoPreviewImage.removeAttribute("src");
  photoSize.textContent = "";
  photoPreview.hidden = true;
  if (!file) return;
  setMessage("Mengompres foto di perangkat…");
  photoInput.disabled = true;
  try {
    compressedPhoto = await compressPhoto(file);
    photoPreviewUrl = URL.createObjectURL(compressedPhoto);
    photoPreviewImage.src = photoPreviewUrl;
    photoSize.textContent = "Siap diunggah · " + Math.max(1, Math.round(compressedPhoto.size / 1024)) + " KB";
    photoPreview.hidden = false;
    setMessage("Foto siap. Lanjutkan untuk mencatat kehadiran.", "success");
  } catch (error) {
    resetPhoto();
    setMessage(error.message, "error");
  } finally {
    photoInput.disabled = false;
  }
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!selectedEvent || !compressedPhoto) {
    setMessage("Pilih foto bukti terlebih dahulu.", "error");
    return;
  }
  const cohort = $("#checkin-cohort").value;
  const studyProgram = $("#checkin-program").value;
  const memberId = $("#checkin-member").value;
  const button = $("#checkin-submit");
  button.disabled = true;
  try {
    setMessage("Menyiapkan unggahan foto…");
    const upload = await request("POST", { token: selectedEvent.public_token }, {
      mode: "prepare_upload", cohort, study_program: studyProgram, member_id: memberId
    });
    if (!upload.already_uploaded) {
      setMessage("Mengunggah foto terkompres…");
      const formData = new FormData();
      formData.append("cacheControl", "3600");
      formData.append("", compressedPhoto, "proof.jpg");
      const uploadResponse = await window.cssmoraFetch(upload.signed_upload_url, {
        method: "PUT",
        headers: { apikey: config.publishableKey, "x-upsert": "false" },
        body: formData
      }, 30000);
      const uploadResult = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok) throw new Error(uploadResult.message || uploadResult.error || "Foto belum berhasil diunggah. Coba lagi.");
    }
    setMessage("Mencatat kehadiran…");
    const result = await request("POST", { token: selectedEvent.public_token }, {
      mode: "finalize", cohort, study_program: studyProgram, member_id: memberId, photo_path: upload.path
    });
    form.hidden = true;
    resetPhoto();
    setMessage(result.message || "Absensi berhasil dicatat.", "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
});
window.addEventListener("beforeunload", () => { if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl); });

if (config?.url && config?.publishableKey) {
  void refreshActiveEvents();
  refreshTimer = window.setInterval(() => { if (!document.hidden) void refreshActiveEvents(true); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshActiveEvents(true); });
} else {
  hideCheckin("Layanan absensi belum siap. Coba muat ulang halaman.", "error");
}
