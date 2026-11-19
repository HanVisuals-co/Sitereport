import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { buttonClass } from "@/components/ui/button";
import { SmallSubmit } from "@/components/ui/confirm-submit";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABEL, type ProjectRole } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

import { acceptInvite } from "../actions";

// Membaca sesi di level atas, jadi route ini boleh blocking.
// Lihat docs Next: guides/authentication-with-cache-components.
export const instant = false;

export const metadata: Metadata = { title: "Undangan proyek · SiteReport" };

type Preview = {
  project_name: string;
  workspace_name: string;
  role: ProjectRole;
  is_valid: boolean;
  already_member: boolean;
};

export default async function InvitePage(props: PageProps<"/join/[token]">) {
  const { token } = await props.params;
  const { error } = await props.searchParams;
  const user = await requireUser();

  const supabase = await createClient();
  const { data } = await supabase.rpc("preview_project_invite", { p_token: token });
  const invite = (data as Preview[] | null)?.[0];

  return (
    <>
      <AppHeader title="SiteReport" email={user.email} />
      <main className="mx-auto w-full max-w-sm px-4 py-10">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          {!invite || !invite.is_valid || error ? (
            <div className="flex flex-col gap-3">
              <h1 className="text-xl font-semibold">Undangan tidak berlaku</h1>
              <p className="text-zinc-700">
                Link ini salah, sudah dicabut, sudah kedaluwarsa, atau kuotanya habis. Minta link
                baru ke Admin proyek.
              </p>
              <Link href="/" className={buttonClass("secondary")}>
                Ke beranda
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm text-zinc-600">{invite.workspace_name} mengundangmu ke</p>
                <h1 className="text-xl font-semibold">{invite.project_name}</h1>
              </div>
              <p className="text-zinc-700">
                Peran: <span className="font-medium">{ROLE_LABEL[invite.role]}</span>
              </p>
              {invite.already_member ? (
                <form action={acceptInvite.bind(null, token)}>
                  <p className="mb-3 text-sm text-zinc-600">Kamu sudah anggota proyek ini.</p>
                  <SmallSubmit variant="primary">Buka proyek</SmallSubmit>
                </form>
              ) : (
                <form action={acceptInvite.bind(null, token)} className="flex flex-col">
                  <SmallSubmit variant="primary">Terima undangan</SmallSubmit>
                </form>
              )}
              <p className="text-sm text-zinc-500">Masuk sebagai {user.email}</p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
