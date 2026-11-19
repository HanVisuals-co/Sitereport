import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth/session";
import { safeNext } from "@/lib/safe-next";

import { LoginForm } from "./login-form";

// Membaca sesi di level atas, jadi route ini boleh blocking.
// Lihat docs Next: guides/authentication-with-cache-components.
export const instant = false;

export const metadata: Metadata = { title: "Masuk · SiteReport" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { error, next: rawNext } = await props.searchParams;
  const next = safeNext(rawNext);
  if (await getUser()) redirect(next);

  const initialError =
    error === "auth" ? "Link masuk tidak valid atau sudah kedaluwarsa. Minta link baru." : undefined;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Masuk ke SiteReport</h1>
        <p className="mb-6 mt-1 text-zinc-600">Laporan harian proyek, dicek Pengawas.</p>
        {next.startsWith("/join") && (
          <p className="mb-4 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
            Masuk dulu untuk menerima undangan proyek.
          </p>
        )}
        <LoginForm initialError={initialError} next={next} />
      </div>
    </main>
  );
}
