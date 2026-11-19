const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 });

export function formatRupiah(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : rupiah.format(value);
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : number.format(value);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: digits })}%`;
}

/** Nama kolom Excel dari indeks (0 = A). */
export function columnLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
