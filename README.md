# CSSMoRA Lomba

Situs publik informasi dan panel pengelolaan untuk CSSMoRA UNAIR.

**Situs:** https://cssmora.vercel.app  
**Panel admin:** https://cssmora.vercel.app/admin.html

## Struktur proyek

```text
.
├── .openai/hosting.json       # Konfigurasi situs CSSMoRA Sites
├── README.md
└── dist/                     # Folder root untuk deployment Vercel
    ├── assets/                # Logo CSSMoRA dan Kemenag–LPDP
    ├── admin.html             # Login pengurus dan panel pengelolaan
    ├── admin.css              # Gaya panel admin
    ├── admin.js               # Supabase Auth dan operasi katalog
    ├── app.js                 # Katalog publik dan filter
    ├── index.html             # Halaman katalog
    ├── style.css              # Gaya situs
    └── supabase-config.js      # URL dan publishable key Supabase
```

## Aturan proyek & agen AI\n\nPerilaku yang sudah dikunci, instruksi Codex/Claude/Gemini/Copilot, perlindungan Code Owner, dan tes regresi dijelaskan di [PROJECT_RULES.md](PROJECT_RULES.md). CI menjalankan tes tersebut pada pull request ke `main`.\n\n## Supabase

Katalog publik membaca data berstatus `published`. Pengurus dapat mengelola draf dan menerbitkan lomba dari `/admin.html`.

Untuk mengaktifkan akun admin:
1. Buat dan verifikasi akun di **Supabase → Authentication → Users**.
2. Tambahkan email akun tersebut ke tabel `public.competition_admins` melalui SQL Editor:
   `insert into public.competition_admins (email) values (lower('email@contoh.id'));`

Row Level Security membatasi operasi tulis ke email yang terdaftar. Publishable key di frontend memang aman untuk publik; jangan pernah menaruh service-role key di situs.

## Menjalankan lokal

```bash
python -m http.server 8000 --directory dist
``

Lalu buka http://localhost:8000.
