import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/lib/env";

/** Klien Supabase untuk Client Component. */
export function createClient() {
  return createBrowserClient(env.supabaseUrl, env.supabasePublishableKey);
}
