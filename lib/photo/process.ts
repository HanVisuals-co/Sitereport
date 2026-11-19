/**
 * Pipeline foto lapangan di browser:
 * 1. Hash SHA-256 dari file ASLI (untuk deteksi foto duplikat antar laporan).
 * 2. Kompres ke sisi terpanjang 1920px (WebP, fallback JPEG).
 * 3. Kalau kompresi gagal (mis. HEIC yang tidak bisa dibaca browser), pakai file asli.
 *    Pelaksana tidak boleh gagal upload hanya karena kompresi.
 */

export const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 1920;

export type ProcessedPhoto = {
  blob: Blob;
  ext: string;
  contentType: string;
  sha256: string;
  wasCompressed: boolean;
};

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function extFor(type: string, fallbackName: string): string {
  if (type === "image/webp") return "webp";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/heic") return "heic";
  if (type === "image/heif") return "heif";
  const m = /\.([a-z0-9]{2,5})$/i.exec(fallbackName);
  return m ? m[1].toLowerCase() : "jpg";
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function compress(file: File): Promise<Blob | null> {
  try {
    // imageOrientation: "from-image" menghormati orientasi EXIF dari kamera HP.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const webp = await canvasToBlob(canvas, "image/webp", 0.8);
    if (webp && webp.type === "image/webp") return webp;
    return await canvasToBlob(canvas, "image/jpeg", 0.82);
  } catch {
    return null;
  }
}

export class PhotoError extends Error {}

export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  const sha256 = await sha256Hex(file);
  const compressed = await compress(file);
  if (compressed && compressed.size < file.size) {
    return {
      blob: compressed,
      ext: extFor(compressed.type, file.name),
      contentType: compressed.type,
      sha256,
      wasCompressed: true,
    };
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new PhotoError("Foto lebih dari 15 MB dan tidak bisa dikompres. Ambil ulang dengan resolusi lebih kecil.");
  }
  const type = file.type || "image/jpeg";
  return { blob: file, ext: extFor(type, file.name), contentType: type, sha256, wasCompressed: false };
}

/** Lokasi saat foto diambil. Null kalau izin ditolak atau tidak tersedia (foto tetap bisa diunggah). */
export function currentPosition(timeoutMs = 8000): Promise<GeolocationCoordinates | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** Jalankan ulang fn dengan jeda bertambah (1s, 2s, 4s) kalau gagal. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastError;
}
