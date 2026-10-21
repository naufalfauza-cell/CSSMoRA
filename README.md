# CSSMoRA Lomba

Situs publik untuk informasi dan dokumentasi perlombaan CSSMoRA UNAIR.

**Situs:** https://cssmora-lomba-unair.naufal-almaroqi.chatgpt.site

## Struktur proyek

```text
.
├── .openai/
│   └── hosting.json       # Pengaturan direktori publikasi
├── dist/                  # Berkas situs yang langsung dipublikasikan
│   ├── assets/            # Logo CSSMoRA dan Kemenag–LPDP
│   ├── app.js             # Interaksi dan data tampilan
│   ├── index.html         # Struktur halaman
│   └── style.css          # Gaya dan tata letak
└── README.md
```

## Mengedit situs

- Ubah konten dan susunan halaman di `dist/index.html`.
- Ubah interaksi di `dist/app.js`.
- Ubah warna, tipografi, dan tata letak di `dist/style.css`.
- Simpan gambar atau logo di `dist/assets/`, lalu gunakan path relatif seperti `assets/nama-file.png`.

## Menjalankan secara lokal

Jalankan server statis dengan `dist/` sebagai direktori publik. Contoh:

```bash
python -m http.server 8000 --directory dist
```

Lalu buka http://localhost:8000.
