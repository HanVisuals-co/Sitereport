/** Kerangka halaman yang tampil seketika saat pindah halaman, selagi server menyiapkan data. */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Memuat">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-32 animate-pulse rounded bg-zinc-200" />
        <div className="h-8 w-64 animate-pulse rounded bg-zinc-200" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-2xl border border-zinc-200 bg-white" />
      ))}
      <span className="sr-only">Memuat…</span>
    </div>
  );
}
