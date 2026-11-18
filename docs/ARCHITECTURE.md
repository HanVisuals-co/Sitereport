# SiteReport — Arsitektur

Pasangan dari `docs/PRD.md`. Dokumen ini menjelaskan stack, skema database, RLS, state machine laporan, dan alur teknis utama.

## 1. Stack

| Lapisan | Pilihan |
|---|---|
| Frontend | Next.js (App Router) + React + Tailwind CSS, TypeScript strict, PWA (service worker, manifest, Web Push) |
| Backend | Next.js Route Handlers / Server Actions + Supabase |
| Database | Supabase Postgres + Row-Level Security |
| Auth | Supabase Auth (Google OAuth, Email magic link/OTP) |
| File | Supabase Storage (bucket privat, upload resumable TUS) |
| Job terjadwal | `pg_cron` + Supabase Edge Functions |
| AI | Gemini Flash (terbaru), structured output JSON Schema, `temperature: 0`, hanya dipanggil dari server |
| Email | Resend (lokal: Mailpit) |
| Push | Web Push (VAPID) |
| Hosting | Vercel + Supabase Cloud (region Singapore) |
| Test | pgTAP (RLS), Vitest (unit), Playwright (E2E) |

## 2. Struktur repo (rencana)

```
/app                  Next.js App Router
  /(auth)             login, callback, join via invite/kode
  /(field)            layar Pelaksana (mobile, utilitarian)
  /(review)           layar Pengawas
  /(admin)            dashboard & pengaturan Admin
  /api
    /ai/polish        Narrative Polisher
    /export/xlsx      export workbook
    /export/pdf/[id]  PDF laporan harian
    /push/subscribe   simpan subscription Web Push
/lib
  /supabase           client server/browser, tipe hasil generate
  /ai                 klien Gemini, schema, validator angka
  /offline            draft IndexedDB, antrean upload foto
  /photo              kompresi, hash SHA-256, baca EXIF
/supabase
  /migrations         SQL migrasi (skema, RLS, fungsi, trigger)
  /functions          Edge Functions: reminders, push-sender, (v1.1) weekly-summary
  /tests              pgTAP
  seed.sql            data dummy dev
/tests/e2e            Playwright
/docs                 PRD, ARCHITECTURE
```

## 3. Skema database

Semua tabel memakai `id uuid default gen_random_uuid()` kecuali disebut lain. Semua tabel punya `created_at timestamptz default now()`.

### 3.1 Enum

```sql
create type project_role   as enum ('pengawas', 'pelaksana', 'viewer');
create type member_status  as enum ('pending', 'active');
create type project_status as enum ('active', 'archived');
create type report_status  as enum ('draft', 'submitted', 'revision_requested', 'approved');
create type master_kind    as enum ('labor', 'equipment', 'material');
create type weather_slot   as enum ('pagi', 'siang', 'sore');
create type weather_cond   as enum ('cerah', 'berawan', 'hujan');
create type photo_source   as enum ('camera', 'gallery');
create type review_action  as enum ('approve', 'request_revision', 'reopen');
create type dup_resolution as enum ('valid', 'duplicate');
create type weight_source  as enum ('auto', 'manual');
```

### 3.2 Identitas & tenancy

**profiles**
- `id uuid pk` → `auth.users.id`
- `full_name text`, `avatar_url text`

**workspaces**
- `name text`, `slug text unique`, `created_by uuid → profiles`

**workspace_admins**
- `workspace_id → workspaces`, `user_id → profiles`
- pk (`workspace_id`, `user_id`)

**projects**
- `workspace_id → workspaces`
- `name text`, `code text`, `location text`
- `timezone text` (contoh `Asia/Jakarta`)
- `status project_status default 'active'`
- `report_period_days int default 1 check (>= 1)`
- `backdate_limit_days int default 2 check (>= 0)`
- `reminder_time time default '17:00'`
- `join_code text unique`
- `start_date date`, `end_date date`

**project_members**
- `project_id → projects`, `user_id → profiles`
- `role project_role`, `status member_status default 'active'`
- `invited_by uuid → profiles`
- pk (`project_id`, `user_id`). Satu peran per user per proyek.

**project_invites**
- `project_id → projects`, `role project_role`
- `token_hash text unique` (token mentah hanya ada di link, tidak disimpan)
- `expires_at timestamptz` (default now() + 7 hari)
- `max_uses int null`, `used_count int default 0`
- `created_by → profiles`, `revoked_at timestamptz null`

### 3.3 BOQ & master data

**boq_items**
- `project_id → projects`, `parent_id → boq_items null`
- `level smallint check (level between 1 and 3)`
- `code text`, `name text`, `sort_order int`
- `unit text null`, `contract_volume numeric null` (wajib diisi untuk item daun)
- `weight_pct numeric null`, `weight_source weight_source`
- Item daun = item tanpa anak (dihitung lewat query, tidak disimpan sebagai kolom).

**boq_item_prices** (dipisah supaya RLS bisa membatasi ke Admin)
- `boq_item_id pk → boq_items`
- `unit_price numeric`

Trigger: setiap perubahan `boq_item_prices` atau `contract_volume` menghitung ulang `weight_pct` untuk item ber-`weight_source = 'auto'`:

```
weight_pct = (unit_price × contract_volume) / Σ (unit_price × contract_volume semua item daun proyek) × 100
```

**master_items**
- `project_id → projects`, `kind master_kind`
- `name text`, `unit text null`, `active bool default true`
- unique (`project_id`, `kind`, `lower(name)`)

### 3.4 Laporan

**reports**
- `project_id → projects`, `author_id → profiles`
- `period_start date`, `period_end date` (tanggal lokal proyek)
- `status report_status default 'draft'`
- `is_late bool default false`
- `notes_raw text`, `notes_polished text null`
- `submitted_at timestamptz null`, `approved_at timestamptz null`, `approved_by → profiles null`
- `backdate_unlocked_by → profiles null` (Admin yang membuka akses lewat batas N hari)
- unique (`project_id`, `author_id`, `period_start`)

**report_weather**
- `report_id → reports`, `slot weather_slot`, `condition weather_cond`, `rain_hours numeric default 0`
- pk (`report_id`, `slot`)

**report_labor**
- `report_id`, `master_item_id → master_items (kind = labor)`, `count int check (>= 0)`

**report_equipment**
- `report_id`, `master_item_id → master_items (kind = equipment)`, `count int`, `hours numeric`

**report_materials**
- `report_id`, `master_item_id → master_items (kind = material)`, `quantity numeric`

**report_volumes**
- `report_id`, `boq_item_id → boq_items (daun)`, `volume numeric check (>= 0)`
- `dup_flag bool default false`, `dup_of_report_id uuid null`
- `dup_resolution dup_resolution null`, `dup_resolved_by → profiles null`

**report_photos**
- `report_id → reports`, `storage_path text`
- `sha256 text` (hash file **asli** sebelum kompresi)
- `source photo_source`, `taken_at timestamptz`
- `lat double precision null`, `lng double precision null`, `accuracy_m real null`
- `boq_item_id → boq_items null`, `size_bytes int`, `was_compressed bool`
- `dup_flag bool default false`, `dup_resolution dup_resolution null`
- index (`sha256`)

**report_reviews**
- `report_id`, `reviewer_id → profiles`, `action review_action`, `note text`

**report_review_comments**
- `review_id → report_reviews`, `section text` (`cuaca`, `tenaga_kerja`, `alat`, `material`, `volume`, `catatan`, `foto`), `comment text`

### 3.5 Notifikasi, AI, audit

**notifications**: `user_id`, `type text`, `payload jsonb`, `read_at timestamptz null`

**push_subscriptions**: `user_id`, `endpoint text unique`, `p256dh text`, `auth text`, `user_agent text`

**ai_runs**: `report_id null`, `kind text` (`polish`, nanti `anomaly`, `weekly`), `model text`, `input_tokens int`, `output_tokens int`, `ok bool`, `error text null`. Dipakai untuk melacak biaya dan debugging. Tidak menyimpan teks mentah.

**audit_log**: `workspace_id`, `project_id null`, `actor_id`, `entity text`, `entity_id uuid`, `action text`, `before jsonb`, `after jsonb`. Hanya bisa di-insert lewat fungsi `security definer`. Tidak ada update atau delete.

### 3.6 View rekap

**v_report_volume_effective**: volume dari laporan `approved`, kecuali baris dengan `dup_resolution = 'duplicate'`.

**v_boq_progress**: per item daun: volume kumulatif, % terhadap kontrak, kontribusi bobot.

**v_project_progress**: `Σ least(kumulatif / kontrak, 1) × weight_pct`.

Dashboard dan export hanya membaca dari view ini.

## 4. State machine laporan

```
            submit                    approve
 draft ───────────────► submitted ───────────────► approved (terkunci)
                         │    ▲                        │
         request_revision│    │submit           reopen │ (Admin saja)
                         ▼    │                        ▼
                     revision_requested ◄──────────────┘
```

Aturan transisi, ditegakkan oleh fungsi Postgres `security definer` (bukan oleh update langsung dari klien):

| Fungsi | Siapa | Syarat |
|---|---|---|
| `submit_report(id)` | Pelaksana pembuat | status `draft`/`revision_requested`; ada ≥ 1 foto; semua foto selesai upload; periode dalam batas backdate atau sudah dibuka Admin. Menjalankan cek duplikat, mengisi `is_late`, mengirim notifikasi. |
| `request_revision(id, note, comments[])` | Pengawas proyek, bukan pembuat | status `submitted` |
| `resolve_duplicate(row_id, kind, resolution)` | Pengawas proyek | laporan `submitted` |
| `approve_report(id, note)` | Pengawas proyek, bukan pembuat | status `submitted`; semua flag duplikat sudah diputuskan; tidak ada resolusi `duplicate` (kalau ada, wajib request revision) |
| `reopen_report(id, note)` | Admin workspace | status `approved` → `revision_requested`, tercatat di audit log |

Setelah `approved`, trigger menolak setiap update atau delete pada `reports` dan semua tabel anak `report_*`.

### Cek duplikat (di `submit_report`)
- **Volume**: untuk setiap baris `report_volumes` dengan `volume > 0`, cari baris di laporan lain (`author_id` berbeda, proyek sama, status `submitted`/`approved`, periode beririsan, `boq_item_id` sama) dengan `abs(a - b) <= 0.01 × greatest(a, b)`. Kalau ada, isi `dup_flag = true` dan `dup_of_report_id`.
- **Foto**: `sha256` sama dengan foto di laporan lain di proyek yang sama, maka `dup_flag = true`.
- **Melebihi kontrak**: kalau volume kumulatif + volume baru > `contract_volume`, munculkan peringatan saja (dikembalikan ke UI, tidak disimpan sebagai flag).

## 5. RLS

### Fungsi helper (`security definer`, `stable`, `search_path` dikunci)

```sql
is_workspace_admin(ws uuid) returns bool
project_role(p uuid) returns project_role   -- null kalau bukan anggota aktif
is_project_admin(p uuid) returns bool       -- admin dari workspace pemilik proyek
can_read_project(p uuid) returns bool       -- admin atau anggota aktif
```

### Kebijakan utama

| Tabel | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| workspaces | admin workspace; anggota proyek di workspace itu (nama saja) | admin |
| workspace_admins | admin | admin |
| projects | `can_read_project` | admin |
| project_members | `can_read_project` | admin; join via invite/kode lewat fungsi |
| project_invites | admin | admin |
| boq_items | `can_read_project` | admin |
| **boq_item_prices** | **admin saja** | admin |
| master_items | `can_read_project` | admin; Pelaksana boleh insert (tambah cepat dari form) |
| reports | admin; Pengawas proyek (status ≠ `draft`); pembuat | insert/update oleh pembuat saat status `draft`/`revision_requested`; transisi status hanya lewat fungsi |
| report_* (anak) | mengikuti `reports` | pembuat saat laporan bisa diedit |
| report_reviews / comments | mengikuti `reports` | hanya lewat fungsi |
| notifications | pemilik | insert lewat fungsi/service role; update `read_at` oleh pemilik |
| push_subscriptions | pemilik | pemilik |
| audit_log | admin workspace | hanya lewat fungsi |
| ai_runs | admin workspace | service role |

Viewer (v1.1) hanya membaca `weekly_summaries` yang sudah dirilis.

### Storage
- Bucket `report-photos`, privat.
- Path: `{workspace_id}/{project_id}/{report_id}/{photo_id}.{ext}`.
- Policy upload: pembuat laporan, selama laporan bisa diedit.
- Policy baca: sama dengan aturan baca `reports`.
- Klien hanya menerima signed URL dengan masa berlaku pendek.

### Test pgTAP wajib
- User dari workspace A tidak bisa membaca apa pun dari workspace B.
- Pengawas eksternal hanya melihat proyek tempat ia diundang.
- Pelaksana dan Pengawas tidak bisa membaca `boq_item_prices`.
- Pengawas tidak bisa meng-approve laporannya sendiri.
- Laporan `approved` tidak bisa diubah, kecuali lewat `reopen_report` oleh Admin.
- Pelaksana tidak bisa melihat draft Pelaksana lain.

## 6. Alur teknis utama

### 6.1 Draft offline & upload foto
1. Form disimpan otomatis ke IndexedDB per (`project_id`, `period_start`).
2. Foto diambil dari kamera (`<input capture>` / `getUserMedia`) atau galeri (setelah peringatan). Sumber disimpan sebagai `source`.
3. Hash SHA-256 dihitung dari file asli. EXIF dan GPS dibaca (`navigator.geolocation` sebagai fallback).
4. Kompresi di Web Worker: sisi terpanjang 1920px, WebP/JPEG. Kalau gagal, pakai file asli (batas 15 MB).
5. Blob disimpan di IndexedDB, lalu masuk antrean upload TUS ke Supabase Storage dengan retry eksponensial.
6. Saat online, draft laporan dibuat di server (`status = draft`). Baris `report_photos` dibuat setelah upload sukses.
7. Tombol Submit aktif hanya kalau online dan semua foto berstatus terkirim.

### 6.2 Narrative Polisher
1. Klien memanggil `POST /api/ai/polish` dengan `report_id` dan `notes_raw`.
2. Server memverifikasi bahwa user adalah pembuat laporan.
3. Gemini dipanggil dengan `temperature: 0` dan JSON Schema `{ polished: string }`. Prompt sistem melarang penambahan angka atau fakta.
4. **Validator**: ekstrak semua angka dari output. Setiap angka harus ada di input. Kalau gagal, kembalikan error dan teks mentah tetap dipakai.
5. Catat ke `ai_runs`. Klien menampilkan hasil, user boleh edit, lalu disimpan ke `notes_polished`.

### 6.3 Notifikasi
- Fungsi transisi status meng-insert ke `notifications` dan `pg_net`/Edge Function `push-sender` mengirim Web Push ke semua `push_subscriptions` user. Subscription yang mengembalikan 404/410 dihapus.
- Email lewat Resend dikirim dari Edge Function yang sama untuk event yang memakai email (lihat PRD 6.8).
- Klien berlangganan perubahan `notifications` lewat Supabase Realtime untuk badge in-app.

### 6.4 Pengingat belum lapor
- `pg_cron` berjalan setiap 15 menit dan memanggil Edge Function `reminders`.
- Fungsi memilih proyek aktif yang `reminder_time` (di zona waktu proyek) jatuh di jendela 15 menit terakhir.
- Pelaksana aktif tanpa laporan `submitted`/`approved` untuk periode berjalan menerima notifikasi. Pengawas menerima ringkasan daftar yang belum lapor.

### 6.5 Export
- `.xlsx` digenerate di server (misalnya `exceljs`) dari view rekap, satu sheet per bagian. Link foto berupa signed URL berumur panjang atau link ke halaman aplikasi.
- PDF laporan harian digenerate di server (misalnya `@react-pdf/renderer`). Foto diberi watermark saat render.

## 7. Konfigurasi lingkungan

| Variabel | Keterangan |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | klien |
| `SUPABASE_SERVICE_ROLE_KEY` | server saja |
| `GEMINI_API_KEY` | server saja. Dev: tier gratis + data dummy. Pilot: tier berbayar. |
| `RESEND_API_KEY`, `EMAIL_FROM` | dev: `onboarding@resend.dev`; pilot: `notifikasi@<domain>` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push |

SMTP Supabase Auth (pilot): host `smtp.resend.com`, port `465`, user `resend`, password = `RESEND_API_KEY`.

Lokal: `supabase start` menyalakan Postgres, Auth, Storage, dan Mailpit (`http://localhost:54324`). Tes di HP butuh HTTPS, jadi gunakan deploy beta di Vercel + Supabase Cloud.

## 8. Tambahan v1.1 (rencana skema)

- **weekly_summaries**: `project_id`, `week_start date`, `content jsonb`, `status ('draft','released')`, `reviewed_by`, `released_at`.
- **anomalies**: `report_id`, `rule_code text`, `details jsonb`, `explanation text null`, `acknowledged_by null`.
- Peran `viewer` sudah ada di enum sejak v1.
