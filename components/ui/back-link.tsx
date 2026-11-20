import Link from "next/link";
import type { ReactNode } from "react";

/** Tombol kembali ke halaman induk. Cukup besar untuk jempol, dengan efek tekan. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 max-w-full items-center gap-1.5 self-start rounded-lg border border-zinc-300 bg-white py-2 pr-4 pl-2.5 text-base font-medium text-zinc-900 transition hover:bg-zinc-100 active:scale-[0.97] active:bg-zinc-200"
    >
      <svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0">
        <path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="truncate">{children}</span>
    </Link>
  );
}
