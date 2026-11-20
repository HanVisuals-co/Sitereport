import "server-only";

import { cache } from "react";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string | null };

/** User yang sedang login, atau null. JWT diverifikasi lewat getClaims(). */
async function getUserUncached(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: (claims.email as string | undefined) ?? null };
}

/** Wajib login. Kalau belum, arahkan ke /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Dipanggil berkali-kali per request (layout + halaman); hasilnya dibagi lewat cache(). */
export const getUser = cache(getUserUncached);
