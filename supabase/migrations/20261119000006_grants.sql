-- SiteReport: hak akses tabel eksplisit untuk role authenticated.
-- Project Supabase baru tidak lagi memberi hak tabel public ke anon/authenticated secara
-- otomatis. RLS tetap menjadi penjaga baris; grant di sini hanya membuka tabel ke Data API.
-- Tabel dengan pembatasan kolom (reports, report_volumes, report_photos, notifications)
-- sengaja TIDAK diberi INSERT/UPDATE level tabel, karena itu akan menimpa batasan kolom
-- dari migrasi 20261119000002.

grant usage on schema public to authenticated;

grant select, update on public.profiles to authenticated;

grant select, insert, update, delete on
  public.workspaces,
  public.workspace_admins,
  public.projects,
  public.project_members,
  public.project_invites,
  public.boq_items,
  public.boq_item_prices,
  public.master_items,
  public.report_weather,
  public.report_labor,
  public.report_equipment,
  public.report_materials,
  public.push_subscriptions
to authenticated;

-- Insert/update dibatasi per kolom (lihat migrasi RLS).
grant select, delete on public.reports, public.report_volumes, public.report_photos
to authenticated;

grant select on
  public.notifications,
  public.report_reviews,
  public.report_review_comments,
  public.ai_runs,
  public.audit_log,
  public.report_backdate_unlocks
to authenticated;

-- Fungsi helper yang dibuat setelah migrasi RLS dan dipakai di policy/trigger.
grant execute on all functions in schema private to authenticated;

-- anon tidak membutuhkan akses tabel apa pun.
revoke all on all tables in schema public from anon;
