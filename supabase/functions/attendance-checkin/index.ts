const corsHeaders = {
  "Access-Control-Allow-Origin": "https://cssmora.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const normalizeName = (value: unknown) =>
  String(value ?? "").normalize("NFKC").trim().replace(/\\s+/g, " ").toLocaleLowerCase("id-ID");

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "Metode tidak didukung." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Layanan absensi belum siap." }, 500);

  let input: Record<string, unknown> = {};
  if (request.method === "POST") input = await request.clone().json().catch(() => ({}));
  const token = new URL(request.url).searchParams.get("token") ?? String(input.token ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "Tautan absensi tidak valid." }, 400);

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const eventUrl = `${supabaseUrl}/rest/v1/secretariat_attendance_events?select=id,title,event_date,session_name,status&public_token=eq.${encodeURIComponent(token)}&limit=1`;
  const eventResponse = await fetch(eventUrl, { headers });
  if (!eventResponse.ok) return json({ error: "Kegiatan absensi tidak ditemukan." }, 404);
  const event = (await eventResponse.json())[0];
  if (!event) return json({ error: "Kegiatan absensi tidak ditemukan." }, 404);
  if (event.status !== "open") return json({ error: "Absensi kegiatan ini sudah ditutup." }, 410);

  if (request.method === "GET") return json({ title: event.title, event_date: event.event_date, session_name: event.session_name });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (event.event_date !== today) return json({ error: "Tautan absensi hanya aktif pada tanggal kegiatan." }, 403);
  const nia = String(input.nia ?? "").trim();
  const fullName = String(input.full_name ?? "").trim();
  if (nia.length < 3 || nia.length > 40 || fullName.length < 2 || fullName.length > 140) {
    return json({ error: "Isi NIA dan nama lengkap dengan benar." }, 400);
  }

  const memberResponse = await fetch(`${supabaseUrl}/rest/v1/secretariat_members?select=id,full_name&nia=eq.${encodeURIComponent(nia)}&limit=1`, { headers });
  if (!memberResponse.ok) return json({ error: "Data tidak cocok. Periksa NIA dan nama, lalu coba lagi." }, 400);
  const member = (await memberResponse.json())[0];
  if (!member || normalizeName(member.full_name) !== normalizeName(fullName)) {
    return json({ error: "Data tidak cocok. Periksa NIA dan nama, lalu coba lagi." }, 400);
  }

  const recordResponse = await fetch(`${supabaseUrl}/rest/v1/secretariat_attendance_records?select=status&event_id=eq.${event.id}&member_id=eq.${member.id}&limit=1`, { headers });
  if (!recordResponse.ok) return json({ error: "Data absensi belum dapat diperiksa." }, 500);
  const record = (await recordResponse.json())[0];
  if (!record) return json({ error: "Nama ini belum tercatat pada roster kegiatan. Hubungi sekretaris." }, 403);
  if (record.status !== "belum") return json({ error: "Absensi sudah tercatat. Hubungi sekretaris bila perlu koreksi." }, 409);

  const saveResponse = await fetch(`${supabaseUrl}/rest/v1/secretariat_attendance_records?on_conflict=event_id,member_id`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ event_id: event.id, member_id: member.id, status: "hadir", updated_at: new Date().toISOString() }),
  });
  if (!saveResponse.ok) return json({ error: "Absensi belum tersimpan. Silakan coba lagi." }, 500);
  return json({ success: true, message: "Absensi berhasil dicatat." });
});
