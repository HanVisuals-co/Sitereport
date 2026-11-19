import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { env } from "@/lib/env";

/**
 * Klien Supabase untuk Server Component, Server Action, dan Route Handler.
 * Buat baru di setiap request; jangan disimpan di variabel global.
 */
export async function createClient() {
  // Klien auth Supabase memanggil Date.now() saat membaca sesi. Dengan Cache Components,
  // itu tidak boleh terjadi saat prerender (termasuk runtime prefetch), jadi tandai
  // rendering ini sebagai per-request dulu.
  await connection();
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Dipanggil dari Server Component: cookie tidak bisa ditulis di sini.
          // Aman diabaikan karena proxy.ts yang menyegarkan sesi.
        }
      },
    },
  });
}
