# SiteReport — Product Requirements Document

Status: Disepakati (hasil sesi brainstorming 2026-11-18)
Versi dokumen: 1.0

## 1. Ringkasan

SiteReport adalah aplikasi web B2B SaaS (mobile-first, PWA) untuk pelaporan harian proyek konstruksi dan teknik sipil. Target awal: kontraktor dan konsultan pengawas di Indonesia.

Filosofi **Human-First, AI-Assisted**:
- Semua angka lapangan (tenaga kerja, volume, material, alat, cuaca) diinput manusia lewat form terstruktur. Angka bersifat deterministik.
- AI hanya merapikan narasi, menjelaskan anomali, dan merangkum. AI tidak pernah membuat atau mengubah angka.

## 2. Target pengguna & strategi peluncuran

- Pilot dengan 2–5 kontraktor kecil-menengah, onboarding manual oleh tim SiteReport.
- Belum ada self-serve signup publik dan belum ada billing di v1.
- Model harga (rencana): **per proyek aktif per bulan**. Skema data menyimpan status proyek `active` / `archived` sejak v1.
- Bahasa: Indonesia saja. Zona waktu disimpan per proyek (WIB/WITA/WIT). Tanggal laporan memakai tanggal lokal proyek.

## 3. Peran

Peran Admin melekat di **workspace**. Peran lain melekat di **proyek**.

| Peran | Level | Kemampuan |
|---|---|---|
| Admin | Workspace | Kelola workspace, proyek, BOQ, harga, master data, anggota, undangan, pengaturan proyek, buka ulang laporan Approved, lihat semua rekap |
| Pengawas (Checker) | Proyek | Review laporan, Approve / Request Revision, putuskan flag duplikat |
| Pelaksana (Maker) | Proyek | Isi laporan pada proyek yang ditugaskan, perbaiki revisi |
| Viewer (v1.1) | Proyek | Read-only: Weekly Summary yang sudah dirilis |

Aturan:
- Satu workspace boleh punya banyak Admin.
- Satu user boleh ikut banyak workspace dan banyak proyek.
- User eksternal (misalnya Pengawas dari konsultan MK) bisa diundang ke proyek tertentu saja, tanpa menjadi anggota workspace.
- Admin boleh juga memegang peran proyek.
- **Pengawas tidak boleh meng-approve laporan buatannya sendiri.**

## 4. Onboarding & autentikasi

- Login: Google Sign-In atau Email (magic link / OTP).
- **Invite link** membawa peran (Pengawas/Pelaksana) dan kedaluwarsa dalam 7 hari.
- **Kode proyek**: user yang bergabung lewat kode masuk status `pending` dan baru aktif setelah disetujui Admin.
- Onboarding mengajak user meng-install PWA ke home screen, karena Web Push di iOS membutuhkannya.

## 5. Scope per versi

### v1.0 (MVP)
1. Workspace, proyek, anggota, undangan, kode proyek.
2. BOQ: import template `.xlsx` + edit manual.
3. Daftar master per proyek: kategori tenaga kerja, alat, material.
4. Form laporan + foto (timestamp, GPS, sumber kamera/galeri).
5. Alur maker-checker + flag duplikat.
6. Narrative Polisher (Gemini).
7. Notifikasi: in-app + Web Push (utama), email (undangan, login, cadangan).
8. Pengingat belum lapor.
9. Dashboard rekapitulasi.
10. Export `.xlsx` / CSV + PDF laporan harian.
11. Audit log.

### v1.1
- Anomaly Detector.
- Weekly Executive Summary + peran Viewer.
- Notifikasi WhatsApp.

### v2
- Kurva S (rencana vs realisasi). **Perlu sesi riset dulu**: format file yang umum dipakai kontraktor (Excel, export MS Project / Primavera, dll.) dan cara integrasinya.
- Auto-Sync Google Sheets.
- Billing self-serve.

## 6. Fitur detail (v1)

### 6.1 Proyek
Pengaturan per proyek (diatur Admin):
- Zona waktu.
- **Periode laporan** dalam hari, default 1 (harian).
- **Batas backdate** N hari, default 2.
- **Jam pengingat** belum lapor, default 17:00 waktu proyek.
- Status `active` / `archived`.

### 6.2 BOQ
- Struktur bertingkat maksimal 3 level: Divisi > Sub-pekerjaan > Item. Volume dan satuan hanya ada di item level terbawah.
- Field item: kode, uraian, satuan, volume kontrak, harga satuan (opsional), bobot %.
- **Bobot**: dihitung otomatis dari nilai (harga satuan × volume) kalau harga diisi. Kalau tidak, bobot diisi manual.
- **Harga satuan hanya terlihat oleh Admin.**
- Masuk lewat template `.xlsx` SiteReport (unduh, isi, upload) atau editor manual.
- Admin boleh menambah item dan mengubah volume di tengah proyek. Semua perubahan masuk audit log. Belum ada alur CCO formal.
- Laporan baru bisa dibuat setelah proyek punya BOQ.

### 6.3 Form laporan
Satu laporan per **Pelaksana per proyek per periode**.

Isi form:
1. **Cuaca** pagi / siang / sore: cerah, berawan, atau hujan, plus jam hujan.
2. **Tenaga kerja**: jumlah per kategori (dari daftar master).
3. **Alat berat**: jenis (dari daftar master), jumlah, jam operasi.
4. **Material masuk**: material (dari daftar master), quantity, satuan.
5. **Volume pekerjaan** per item BOQ.
6. **Kendala / catatan**: teks bebas, bisa dirapikan oleh Narrative Polisher.
7. **Foto**: minimal 1.

Daftar master bisa ditambah cepat langsung dari form.

Backdate:
- Pelaksana boleh membuat laporan untuk periode yang lewat sampai N hari ke belakang. Laporan diberi tanda **terlambat**.
- Lewat dari N hari, hanya Admin yang bisa membuka akses.

Draft:
- Draft (isi form dan foto) tersimpan otomatis di perangkat (IndexedDB).
- **Submit wajib online.**

### 6.4 Foto
- Kamera di aplikasi diutamakan.
- Foto dari galeri tetap boleh. Sebelum memilih, user diberi peringatan bahwa foto akan ditandai **"dari galeri"**. Tanda ini terlihat oleh Pengawas.
- Metadata: waktu ambil, koordinat GPS + akurasi, sumber, hash SHA-256 file asli.
- Tautan ke item BOQ bersifat opsional.
- File asli disimpan tanpa watermark. Watermark (waktu, GPS, nama proyek) ditampilkan saat dilihat atau diekspor.
- **Upload tidak boleh gagal karena kompresi:**
  - Kompresi di klien: sisi terpanjang maksimal 1920px, WebP/JPEG sekitar 300–500 KB.
  - Kompresi gagal (misalnya HEIC)? Upload file asli, batas 15 MB.
  - Upload resumable (TUS) dengan retry otomatis.
  - Status per foto terlihat: terkirim / mengirim / gagal (ulangi).

### 6.5 Alur maker-checker
- Status: `draft` → `submitted` → (`revision_requested` → `submitted`)* → `approved`.
- Pengawas punya dua aksi: **Approve** atau **Request Revision**. Keduanya disertai catatan umum, plus komentar opsional per bagian form.
- Tidak ada Reject permanen.
- Cukup **satu** Pengawas proyek yang menyetujui.
- Laporan `approved` **terkunci**. Koreksi hanya bisa lewat buka ulang oleh Admin, tercatat di audit log.

### 6.6 Flag duplikat
Dicek saat laporan disubmit:
- **Volume**: item BOQ sama, periode beririsan, laporan dari Pelaksana lain, volume > 0, dan selisih ≤ 1%.
- **Foto**: hash SHA-256 sama dengan foto di laporan lain di proyek yang sama.

Flag tampil di layar review. Pengawas wajib memutuskan setiap flag sebelum Approve:
- **"Valid, jumlahkan"**: volume masuk rekap.
- **"Duplikat, minta revisi"**: laporan dikembalikan ke Pelaksana.

Keputusan tercatat di audit log. Flag bersifat peringatan dan tidak memblokir submit.

Peringatan lain: volume kumulatif melebihi volume kontrak memunculkan peringatan, tapi tidak memblokir.

### 6.7 Narrative Polisher
- Pelaksana menekan "Rapikan dengan AI", melihat hasil, dan boleh mengedit sebelum submit.
- Teks mentah dan teks rapi sama-sama disimpan. Pengawas melihat teks rapi, dengan toggle ke teks mentah.
- AI dilarang menambah angka atau fakta. Server memvalidasi bahwa setiap angka di output juga ada di input. Kalau gagal, hasil ditolak dan teks mentah dipakai.
- Gemini dipanggil hanya dari server. `temperature: 0`, structured output (JSON Schema).

### 6.8 Notifikasi
| Event | Penerima | Saluran |
|---|---|---|
| Laporan disubmit | Pengawas proyek | In-app + Push + Email |
| Request Revision | Pelaksana pembuat | In-app + Push + Email |
| Approved | Pelaksana pembuat | In-app + Push |
| Belum lapor (jam pengingat) | Pelaksana | In-app + Push |
| Ringkasan belum lapor | Pengawas | In-app + Push |
| Undangan | Yang diundang | Email |
| Permintaan gabung via kode | Admin | In-app + Push |
| Login | User | Email |

Aplikasi (in-app + Web Push) adalah saluran utama. Email jadi cadangan.

### 6.9 Dashboard rekapitulasi
Semua angka hanya dari laporan `approved`, tidak termasuk volume yang diputuskan duplikat.
- Progres fisik % per proyek (realisasi saja).
- Volume kumulatif per item BOQ dan % terhadap kontrak.
- Grafik tenaga kerja dan alat per hari.
- Material kumulatif.
- Status laporan: pending, revisi, terlambat, belum lapor.
- Filter rentang tanggal.

Rumus progres:

```
progres_proyek = Σ ( min(volume_kumulatif_item / volume_kontrak_item, 1) × bobot_item )
```

### 6.10 Export
- Workbook `.xlsx` digenerate di server, satu sheet per bagian:
  1. Rekap BOQ
  2. Tenaga Kerja harian
  3. Alat
  4. Material
  5. Cuaca
  6. Daftar Laporan (status + link foto)
- CSV tersedia per sheet.
- **PDF laporan harian** per laporan Approved, berisi nama dan waktu persetujuan Pengawas. Belum memakai e-sign bersertifikat.

## 7. Fitur v1.1 (ringkas)

- **Anomaly Detector**: aturan deterministik di SQL/kode. Contoh: volume pengecoran > 0 tapi tenaga kerja = 0, atau semen masuk = 0 padahal ada pengecoran. AI hanya menulis penjelasan anomali untuk Pengawas.
- **Weekly Executive Summary**: digenerate otomatis setiap Senin pagi dari laporan Approved minggu sebelumnya. Pengawas atau Admin mereview dulu, lalu merilis ke Viewer. Tersedia juga dalam PDF.
- **WhatsApp**: notifikasi tambahan, bukan pengganti aplikasi.

## 8. Kebutuhan non-fungsional

- **Isolasi tenant**: wajib lewat RLS Postgres dan diuji dengan pgTAP.
- **Mobile-first**: layar Pelaksana bergaya utilitarian kontras tinggi, terbaca di bawah sinar matahari, tombol besar (bisa dipakai dengan sarung tangan). Dashboard Admin di desktop bergaya SaaS bersih.
- **Privasi AI**: dev memakai tier gratis Gemini dengan data dummy saja. Pilot dan produksi memakai tier berbayar, karena di tier gratis Google boleh memakai data untuk pelatihan model.
- **Keamanan file**: bucket Storage privat, akses lewat signed URL.
- **Retensi**: foto dan data disimpan selama proyek aktif dan diarsipkan. Penghapusan hanya terjadi saat workspace dihapus.
- **Audit**: perubahan BOQ, keputusan review, keputusan duplikat, dan pembukaan ulang laporan semuanya tercatat.

## 9. Lingkungan & rilis

| Tahap | App | Database | Email |
|---|---|---|---|
| Dev lokal | `next dev` | Supabase CLI (`supabase start`) | Mailpit `http://localhost:54324` |
| Beta di HP | Vercel (`*.vercel.app`, HTTPS) | Supabase Cloud, region Singapore | Resend tanpa domain, hanya ke email akun sendiri |
| Pilot | Vercel + domain sendiri | Supabase Cloud | Resend + domain terverifikasi (SPF/DKIM) |

Domain dibeli saat pilot dimulai.

## 10. Diparkir / perlu riset

- **Kurva S (v2)**: format file yang didukung, sumber data rencana, cara integrasi.
- **Google Sheets sync (v2)**: OAuth dan verifikasi app Google.
- **Billing**: implementasi pembayaran per proyek aktif.
