# Evaluasi performa: aplikasi terasa lambat (20 Nov 2026)

Temuan dari uji produksi di `sitereportid.vercel.app`. Pengguna merasakan jeda setiap kali
pindah halaman atau menyimpan, di laptop maupun HP.

## Pengukuran

| Yang diukur | Hasil |
|---|---|
| Halaman statis `/login` (cache edge Vercel, `sin1`) | TTFB 0,16–0,30 dtk |
| Route dinamis (`/auth/callback`) | TTFB 0,40–0,47 dtk, header `x-vercel-id: sin1::iad1::…` |
| Region database Supabase | `ap-northeast-1` (Tokyo) |
| Region fungsi server Vercel | `iad1` (Washington, AS), bawaan Vercel |

Halaman statis cepat. Lambatnya ada di halaman yang dirender server.

## Penyebab

### 1. Server dan database berada di benua berbeda (utama)

Setiap render halaman berjalan di Washington, sementara setiap query ke database harus
menyeberang ke Tokyo dan kembali. Satu perjalanan ke database sekitar 150 ms.

Jalur satu request dari Indonesia:

```
HP (Indonesia) → edge Singapura → fungsi di Washington ⇄ database di Tokyo (berkali-kali) → kembali
```

### 2. Banyak query berurutan per halaman

Contoh halaman laporan (`reports/[reportId]`):

| Tahap | Query | Berurutan |
|---|---|---|
| Layout workspace | `getWorkspace` (workspace, lalu cek admin) | 2 |
| Halaman, gelombang 1 | `getWorkspace` lagi, `getProject`, `getReport`, lalu signed URL foto | 3 |
| Halaman, gelombang 2 | `getMyRole`, `listMasterItems`, `listBoqLeaves` (BOQ 1.622 baris = 2 halaman) | 2 |

Sekitar 7 perjalanan berurutan × ~150 ms ≈ 1 dtk, ditambah jarak HP ke Washington.
Simpan draft dan kirim laporan (server action) menempuh jalur yang sama.

### 3. Tidak ada umpan balik saat menunggu

Belum ada `loading.tsx` di route mana pun, dan route memakai `instant = false`.
Akibatnya, setelah tombol atau link diklik, layar diam sampai server selesai. Jeda terasa
lebih lama dari yang sebenarnya.

### 4. Query yang terulang

`getWorkspace` dipanggil di layout dan lagi di halaman pada request yang sama, karena
belum dibungkus `cache()` dari React.

## Yang bukan penyebab

- **Verifikasi sesi.** Proyek memakai kunci JWT ES256, jadi `getClaims()` memverifikasi token
  secara lokal tanpa memanggil server Supabase.
- **Ukuran halaman statis.** `/login` dilayani dari cache edge Singapura dengan cepat.

## Perbaikan, urut dampak

| # | Perbaikan | Dampak | Usaha |
|---|---|---|---|
| 1 | Pindahkan fungsi Vercel ke `hnd1` (Tokyo) lewat `vercel.json` → `"regions": ["hnd1"]`, satu region dengan database | Setiap query dari ~150 ms jadi beberapa ms. Perkiraan render halaman laporan turun dari ±1 dtk ke ±0,2 dtk | Kecil (1 file) |
| 2 | Tambah `loading.tsx` (skeleton) di route utama | Umpan balik instan setelah klik | Kecil |
| 3 | Bungkus `requireUser`, `getWorkspace`, `getProject` dengan `cache()` | Hapus query ganda layout + halaman | Kecil |
| 4 | Gabungkan cek workspace + admin jadi satu query/RPC | −1 perjalanan per halaman | Sedang |
| 5 | Jangan muat seluruh BOQ (1.622 baris) setiap buka laporan. Cari item lewat query di server | Payload jauh lebih kecil, terutama di HP | Sedang |

## Rekomendasi jangka panjang (sebelum pilot)

Pengguna ada di Indonesia, jadi idealnya database dan server sama-sama di Singapura
(`ap-southeast-1` + Vercel `sin1`). Jarak Jakarta–Singapura sekitar 15–25 ms, sedangkan
Jakarta–Tokyo sekitar 70–90 ms. Memindahkan Supabase berarti membuat proyek baru di
Singapura dan menjalankan ulang migrasi. Saat ini datanya masih data uji, jadi ini waktu
termurah untuk pindah.
