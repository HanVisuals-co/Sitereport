# SiteReport

Aplikasi web (PWA) untuk laporan harian proyek konstruksi dengan alur maker-checker:
Pelaksana mengisi laporan, Pengawas memverifikasi.

- Keputusan produk: [docs/PRD.md](docs/PRD.md)
- Arsitektur, skema, RLS: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Prasyarat

- Node.js 20+
- Docker Desktop (untuk Supabase lokal)

## Menjalankan di lokal

```bash
npm install
npm run db:start        # Postgres, Auth, Storage, Mailpit
cp .env.example .env.local   # isi URL + publishable key dari output db:start
npm run dev
```

- App: http://localhost:3000
- Supabase Studio: http://localhost:54323
- Mailpit (email lokal): http://localhost:54324

## Database

| Perintah | Fungsi |
|---|---|
| `npm run db:reset` | Terapkan ulang semua migrasi dari nol |
| `npm run db:test` | Jalankan test pgTAP di `supabase/tests` |
| `npm run db:check` | Cek cepat migrasi + RLS tanpa Docker (PGlite, stub auth/storage) |
| `npm run db:types` | Generate tipe TypeScript dari skema lokal |

Migrasi ada di `supabase/migrations`. Jangan ubah migrasi yang sudah diterapkan di Supabase Cloud; buat file migrasi baru.
