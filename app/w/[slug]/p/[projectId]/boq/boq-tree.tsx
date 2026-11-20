"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FormError, TextField } from "@/components/ui/field";
import { formatNumber, formatPercent, formatRupiah } from "@/lib/format";

import { addBoqItem, deleteBoqItem, updateBoqItem, type ItemFormState } from "./actions";

export type TreeItem = {
  id: string;
  parent_id: string | null;
  level: number;
  code: string | null;
  name: string;
  spec: string | null;
  unit: string | null;
  contract_volume: number | null;
  weight_pct: number | null;
};

type Props = {
  items: TreeItem[];
  prices: Record<string, number>;
  isAdmin: boolean;
  slug: string;
  projectId: string;
};

type Dialog =
  | { mode: "edit"; item: TreeItem; isLeaf: boolean }
  | { mode: "add"; parent: TreeItem | null }
  | null;

export function BoqTree({ items, prices, isAdmin, slug, projectId }: Props) {
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);

  const { children, subtotal, leafCount, byId } = useMemo(() => {
    const children = new Map<string | null, TreeItem[]>();
    const byId = new Map<string, TreeItem>();
    for (const it of items) {
      byId.set(it.id, it);
      const list = children.get(it.parent_id) ?? [];
      list.push(it);
      children.set(it.parent_id, list);
    }
    const subtotal = new Map<string, number>();
    const leafCount = new Map<string, number>();
    const walk = (it: TreeItem): [number, number] => {
      const kids = children.get(it.id);
      if (!kids?.length) {
        const total = (it.contract_volume ?? 0) * (prices[it.id] ?? 0);
        subtotal.set(it.id, total);
        return [total, 1];
      }
      let total = 0;
      let count = 0;
      for (const k of kids) {
        const [t, c] = walk(k);
        total += t;
        count += c;
      }
      subtotal.set(it.id, total);
      leafCount.set(it.id, count);
      return [total, count];
    };
    for (const root of children.get(null) ?? []) walk(root);
    return { children, subtotal, leafCount, byId };
  }, [items, prices]);

  const roots = children.get(null) ?? [];
  const grandTotal = roots.reduce((s, r) => s + (subtotal.get(r.id) ?? 0), 0);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    return items
      .filter((it) => !children.get(it.id)?.length)
      .filter((it) => `${it.code ?? ""} ${it.name} ${it.spec ?? ""}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [q, items, children]);

  function pathOf(it: TreeItem) {
    const parts: string[] = [];
    let cur = it.parent_id ? byId.get(it.parent_id) : undefined;
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return parts.join(" › ");
  }

  function renderLeaf(it: TreeItem) {
    const price = prices[it.id];
    return (
      <div
        key={it.id}
        className="flex flex-col gap-1 border-b border-zinc-100 py-2 sm:flex-row sm:items-start sm:gap-4"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            {it.code && <span className="mr-1.5 font-mono text-zinc-500">{it.code}</span>}
            {it.name}
          </p>
          {it.spec && <p className="text-xs text-zinc-500">{it.spec}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums sm:justify-end">
          <span className="font-medium">
            {formatNumber(it.contract_volume)} {it.unit ?? ""}
          </span>
          {isAdmin && (
            <>
              <span className="text-zinc-600">@ {formatRupiah(price)}</span>
              <span className="w-36 text-right">{formatRupiah(subtotal.get(it.id))}</span>
              <span className="w-16 text-right text-zinc-500">{formatPercent(it.weight_pct)}</span>
              <button
                type="button"
                onClick={() => setDialog({ mode: "edit", item: it, isLeaf: true })}
                className="rounded px-2 py-1 text-zinc-700 hover:bg-zinc-100"
              >
                Ubah
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderNode(it: TreeItem): ReactNode {
    const kids = children.get(it.id);
    if (!kids?.length) return renderLeaf(it);
    return (
      <details key={it.id} className="border-b border-zinc-100 [&[open]>summary>svg]:rotate-90">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-lg py-2 marker:hidden active:bg-zinc-100 [&::-webkit-details-marker]:hidden">
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="size-5 shrink-0 text-zinc-500 transition-transform"
          >
            <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className={`min-w-0 flex-1 ${it.level === 1 ? "font-semibold" : "font-medium"}`}>
            {it.code && <span className="mr-1.5 font-mono text-zinc-500">{it.code}</span>}
            {it.name}
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {leafCount.get(it.id)} item
            </span>
          </span>
          {isAdmin && (
            <>
              <span className="hidden text-sm tabular-nums sm:inline">
                {formatRupiah(subtotal.get(it.id))}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setDialog({ mode: "add", parent: it });
                }}
                className="rounded px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                + Item
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setDialog({ mode: "edit", item: it, isLeaf: false });
                }}
                className="rounded px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                Ubah
              </button>
            </>
          )}
        </summary>
        <div className="pl-4 sm:pl-6">
          {kids.map((k) => renderNode(k))}
        </div>
      </details>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari item BOQ…"
          aria-label="Cari item BOQ"
          className="h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 sm:max-w-sm"
        />
        {isAdmin && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-600">
              Total: <span className="font-semibold text-zinc-900">{formatRupiah(grandTotal)}</span>
            </span>
            <Button type="button" variant="secondary" onClick={() => setDialog({ mode: "add", parent: null })}>
              + Grup
            </Button>
          </div>
        )}
      </div>

      {!q && roots.length > 0 && (
        <p className="-mb-2 text-sm text-zinc-600">Ketuk nama grup untuk membuka atau menutup isinya.</p>
      )}
      <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-2 shadow-sm">
        {q ? (
          matches.length === 0 ? (
            <p className="py-6 text-center text-zinc-600">Tidak ada item yang cocok.</p>
          ) : (
            matches.map((it) => (
              <div key={it.id}>
                <p className="pt-2 text-xs text-zinc-500">{pathOf(it)}</p>
                {renderLeaf(it)}
              </div>
            ))
          )
        ) : (
          roots.map((r) => renderNode(r))
        )}
      </div>

      {dialog && (
        <ItemDialog
          key={dialog.mode === "edit" ? `e-${dialog.item.id}` : `a-${dialog.parent?.id ?? "root"}`}
          dialog={dialog}
          price={dialog.mode === "edit" ? prices[dialog.item.id] : undefined}
          slug={slug}
          projectId={projectId}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function ItemDialog({
  dialog,
  price,
  slug,
  projectId,
  onClose,
}: {
  dialog: NonNullable<Dialog>;
  price: number | undefined;
  slug: string;
  projectId: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const action =
    dialog.mode === "edit"
      ? updateBoqItem.bind(null, slug, projectId, dialog.item.id, dialog.isLeaf)
      : addBoqItem.bind(null, slug, projectId, dialog.parent?.id ?? null);
  const [state, formAction, pending] = useActionState<ItemFormState, FormData>(action, {});
  const [deleteError, setDeleteError] = useState<string>();
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const item = dialog.mode === "edit" ? dialog.item : null;
  const showQuantity = dialog.mode === "add" || dialog.isLeaf;
  const title =
    dialog.mode === "edit"
      ? "Ubah item"
      : dialog.parent
        ? `Tambah item di “${dialog.parent.name}”`
        : "Tambah grup utama";

  async function remove() {
    if (!item) return;
    const msg = dialog.mode === "edit" && !dialog.isLeaf
      ? `Hapus grup “${item.name}” beserta semua isinya?`
      : `Hapus item “${item.name}”?`;
    if (!window.confirm(msg)) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await deleteBoqItem(slug, projectId, item.id);
      onClose();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Gagal menghapus item.");
      setDeleting(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl p-0 backdrop:bg-black/40"
    >
      <form action={formAction} className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        <FormError message={state.error ?? deleteError} />
        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <TextField label="Kode" name="code" defaultValue={item?.code ?? ""} />
          <TextField label="Uraian" name="name" required defaultValue={item?.name ?? ""} />
        </div>
        <TextField label="Spesifikasi (opsional)" name="spec" defaultValue={item?.spec ?? ""} />
        {showQuantity && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <TextField
              label="Volume"
              name="volume"
              inputMode="decimal"
              defaultValue={item?.contract_volume?.toString().replace(".", ",") ?? ""}
            />
            <TextField label="Satuan" name="unit" defaultValue={item?.unit ?? ""} />
            <TextField
              label="Harga satuan"
              name="unit_price"
              inputMode="decimal"
              defaultValue={price?.toString().replace(".", ",") ?? ""}
            />
          </div>
        )}
        {dialog.mode === "add" && (
          <p className="text-sm text-zinc-600">
            Kosongkan volume dan satuan kalau ini grup yang nanti diisi sub-item.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {item ? (
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50"
            >
              {deleting ? "Menghapus..." : "Hapus"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
