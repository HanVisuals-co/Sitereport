import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";

export function AppHeader({ title, email }: { title: string; email: string | null }) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4">
        <Link href="/" className="truncate font-semibold">
          {title}
        </Link>
        <div className="flex items-center gap-2">
          {email && <span className="hidden text-sm text-zinc-600 sm:inline">{email}</span>}
          <form action={signOut}>
            <button type="submit" className={buttonClass("ghost", "h-10 px-3 text-sm")}>
              Keluar
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
