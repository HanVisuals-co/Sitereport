"use client";

import { useEffect, useRef, useState } from "react";

import { currentPosition, PhotoError, processPhoto, withRetry } from "@/lib/photo/process";
import type { ReportPhoto } from "@/lib/reports/types";
import { createClient } from "@/lib/supabase/client";

type LocalPhoto = {
  id: string;
  source: "camera" | "gallery";
  previewUrl: string | null;
  status: "processing" | "uploading" | "done" | "error";
  error?: string;
  file?: File;
  storagePath?: string;
};

export function PhotoSection({
  photos: initial,
  basePath,
  reportId,
  onCountChange,
}: {
  photos: ReportPhoto[];
  basePath: string; // {workspace}/{project}/{report}
  reportId: string;
  onCountChange: (uploaded: number, pending: number) => void;
}) {
  const [photos, setPhotos] = useState<LocalPhoto[]>(() =>
    initial.map((p) => ({
      id: p.id,
      source: p.source,
      previewUrl: p.url,
      status: "done",
      storagePath: p.storage_path,
    })),
  );
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const done = photos.filter((p) => p.status === "done").length;
    const pending = photos.filter((p) => p.status === "processing" || p.status === "uploading").length;
    onCountChange(done, pending);
  }, [photos, onCountChange]);

  const update = (id: string, patch: Partial<LocalPhoto>) =>
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  async function upload(id: string, file: File, source: "camera" | "gallery") {
    update(id, { status: "processing", error: undefined });
    try {
      const [processed, coords] = await Promise.all([
        processPhoto(file),
        source === "camera" ? currentPosition() : Promise.resolve(null),
      ]);
      update(id, { status: "uploading" });

      const supabase = createClient();
      const path = `${basePath}/${id}.${processed.ext}`;
      await withRetry(async () => {
        const { error } = await supabase.storage
          .from("report-photos")
          .upload(path, processed.blob, { contentType: processed.contentType, upsert: false });
        // Percobaan ulang setelah upload yang sebenarnya sudah sampai: anggap berhasil.
        if (error && !/exists|duplicate/i.test(error.message)) throw error;
      });

      await withRetry(async () => {
        const { error } = await supabase.from("report_photos").insert({
          id,
          report_id: reportId,
          storage_path: path,
          sha256: processed.sha256,
          source,
          // Kamera: waktu sekarang. Galeri: waktu file terakhir diubah (perkiraan).
          taken_at: new Date(source === "camera" ? Date.now() : file.lastModified).toISOString(),
          lat: coords?.latitude ?? null,
          lng: coords?.longitude ?? null,
          accuracy_m: coords?.accuracy ?? null,
          size_bytes: processed.blob.size,
          was_compressed: processed.wasCompressed,
        });
        if (error && error.code !== "23505") throw error;
      });

      update(id, { status: "done", storagePath: path, file: undefined });
    } catch (e) {
      update(id, {
        status: "error",
        error:
          e instanceof PhotoError
            ? e.message
            : "Gagal mengunggah. Cek sinyal lalu ketuk “Coba lagi”.",
      });
    }
  }

  function addFiles(files: FileList | null, source: "camera" | "gallery") {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) continue;
      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      setPhotos((prev) => [...prev, { id, source, previewUrl, status: "processing", file }]);
      void upload(id, file, source);
    }
  }

  async function remove(p: LocalPhoto) {
    if (!window.confirm("Hapus foto ini?")) return;
    const supabase = createClient();
    if (p.status === "done") {
      const { error } = await supabase.from("report_photos").delete().eq("id", p.id);
      if (error) {
        update(p.id, { error: "Gagal menghapus foto." });
        return;
      }
      if (p.storagePath) await supabase.storage.from("report-photos").remove([p.storagePath]);
    }
    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="flex h-14 items-center justify-center rounded-lg bg-zinc-900 font-medium text-white"
        >
          Ambil foto
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                "Foto dari galeri akan ditandai “dari galeri” dan terlihat oleh Pengawas. Lanjutkan?",
              )
            ) {
              galleryRef.current?.click();
            }
          }}
          className="flex h-14 items-center justify-center rounded-lg border border-zinc-300 bg-white font-medium"
        >
          Dari galeri
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          addFiles(e.target.files, "camera");
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="sr-only"
        onChange={(e) => {
          addFiles(e.target.files, "gallery");
          e.target.value = "";
        }}
      />

      {photos.length === 0 ? (
        <p className="text-sm text-zinc-600">Belum ada foto. Minimal 1 foto sebelum dikirim.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id} className="relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
              {p.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob/signed URL, bukan aset statis
                <img src={p.previewUrl} alt="Foto lapangan" className="aspect-square w-full object-cover" />
              ) : (
                <div className="aspect-square" />
              )}
              <div className="absolute left-1 top-1 flex flex-col gap-1">
                {p.source === "gallery" && (
                  <span className="rounded bg-amber-500 px-1.5 py-0.5 text-xs font-medium text-white">
                    Dari galeri
                  </span>
                )}
                {p.status !== "done" && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium text-white ${p.status === "error" ? "bg-red-600" : "bg-zinc-800/80"}`}
                  >
                    {p.status === "processing"
                      ? "Memproses…"
                      : p.status === "uploading"
                        ? "Mengunggah…"
                        : "Gagal"}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 bg-white p-1">
                {p.status === "error" && p.file ? (
                  <button
                    type="button"
                    onClick={() => void upload(p.id, p.file!, p.source)}
                    className="rounded px-2 py-1 text-xs font-medium text-zinc-900 underline"
                  >
                    Coba lagi
                  </button>
                ) : (
                  <span />
                )}
                {(p.status === "done" || p.status === "error") && (
                  <button
                    type="button"
                    onClick={() => void remove(p)}
                    className="rounded px-2 py-1 text-xs text-red-700"
                  >
                    Hapus
                  </button>
                )}
              </div>
              {p.error && <p className="bg-white px-1 pb-1 text-xs text-red-700">{p.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
