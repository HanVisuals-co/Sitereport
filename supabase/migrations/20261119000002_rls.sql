-- SiteReport: helper otorisasi, Row-Level Security, hak kolom, dan Storage.
-- Lihat docs/ARCHITECTURE.md bagian 5.

-- ---------------------------------------------------------------------------
-- Helper (security definer, search_path kosong)
-- ---------------------------------------------------------------------------
grant usage on schema private to authenticated;

create function private.is_workspace_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_admins
    where workspace_id = ws and user_id = (select auth.uid())
  );
$$;

create function private.is_project_admin(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects pr
    join public.workspace_admins wa on wa.workspace_id = pr.workspace_id
    where pr.id = p and wa.user_id = (select auth.uid())
  );
$$;

-- Peran aktif user di proyek, atau null kalau bukan anggota aktif.
create function private.project_role(p uuid)
returns public.project_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.project_members
  where project_id = p and user_id = (select auth.uid()) and status = 'active';
$$;

create function private.can_read_project(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_project_admin(p) or private.project_role(p) is not null;
$$;

-- Admin, pembuat laporan, atau Pengawas proyek untuk laporan non-draft.
create function private.can_read_report(r uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reports rep
    where rep.id = r
      and (
        rep.author_id = (select auth.uid())
        or private.is_project_admin(rep.project_id)
        or (rep.status <> 'draft' and private.project_role(rep.project_id) = 'pengawas')
      )
  );
$$;

-- Hanya pembuat, selama laporan masih draft atau diminta revisi.
create function private.can_edit_report(r uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reports rep
    where rep.id = r
      and rep.author_id = (select auth.uid())
      and rep.status in ('draft', 'revision_requested')
      and private.project_role(rep.project_id) = 'pelaksana'
  );
$$;

-- Profil boleh dilihat oleh diri sendiri dan oleh orang yang berbagi proyek/workspace.
create function private.can_see_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target = (select auth.uid())
    or exists (
      select 1
      from public.project_members pm
      where pm.user_id = target and private.can_read_project(pm.project_id)
    )
    or exists (
      select 1
      from public.workspace_admins wa
      where wa.user_id = target
        and (
          private.is_workspace_admin(wa.workspace_id)
          or exists (
            select 1 from public.projects pr
            where pr.workspace_id = wa.workspace_id and private.can_read_project(pr.id)
          )
        )
    );
$$;

create function private.try_uuid(t text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return t::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Aktifkan RLS di semua tabel public
-- ---------------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.workspaces             enable row level security;
alter table public.workspace_admins       enable row level security;
alter table public.projects               enable row level security;
alter table public.project_members        enable row level security;
alter table public.project_invites        enable row level security;
alter table public.boq_items              enable row level security;
alter table public.boq_item_prices        enable row level security;
alter table public.master_items           enable row level security;
alter table public.reports                enable row level security;
alter table public.report_weather         enable row level security;
alter table public.report_labor           enable row level security;
alter table public.report_equipment       enable row level security;
alter table public.report_materials       enable row level security;
alter table public.report_volumes         enable row level security;
alter table public.report_photos          enable row level security;
alter table public.report_reviews         enable row level security;
alter table public.report_review_comments enable row level security;
alter table public.notifications          enable row level security;
alter table public.push_subscriptions     enable row level security;
alter table public.ai_runs                enable row level security;
alter table public.audit_log              enable row level security;

-- ---------------------------------------------------------------------------
-- Profil
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (private.can_see_profile(id));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Workspace
-- ---------------------------------------------------------------------------
create policy workspaces_select on public.workspaces
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or private.is_workspace_admin(id)
    or exists (
      select 1 from public.projects pr
      where pr.workspace_id = workspaces.id and private.can_read_project(pr.id)
    )
  );

create policy workspaces_insert on public.workspaces
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy workspaces_update on public.workspaces
  for update to authenticated
  using (private.is_workspace_admin(id))
  with check (private.is_workspace_admin(id));

create policy workspaces_delete on public.workspaces
  for delete to authenticated
  using (private.is_workspace_admin(id));

create policy workspace_admins_select on public.workspace_admins
  for select to authenticated
  using (private.is_workspace_admin(workspace_id));

create policy workspace_admins_insert on public.workspace_admins
  for insert to authenticated
  with check (private.is_workspace_admin(workspace_id));

create policy workspace_admins_delete on public.workspace_admins
  for delete to authenticated
  using (private.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Proyek & keanggotaan
-- ---------------------------------------------------------------------------
-- Pakai kolom baris langsung (bukan lookup by id) agar INSERT ... RETURNING lolos.
create policy projects_select on public.projects
  for select to authenticated
  using (private.is_workspace_admin(workspace_id) or private.project_role(id) is not null);

create policy projects_insert on public.projects
  for insert to authenticated
  with check (private.is_workspace_admin(workspace_id));

create policy projects_update on public.projects
  for update to authenticated
  using (private.is_workspace_admin(workspace_id))
  with check (private.is_workspace_admin(workspace_id));

create policy projects_delete on public.projects
  for delete to authenticated
  using (private.is_workspace_admin(workspace_id));

create policy project_members_select on public.project_members
  for select to authenticated
  using (private.can_read_project(project_id));

-- Bergabung lewat undangan/kode proyek dilakukan oleh fungsi security definer (migrasi berikutnya).
create policy project_members_insert on public.project_members
  for insert to authenticated
  with check (private.is_project_admin(project_id));

create policy project_members_update on public.project_members
  for update to authenticated
  using (private.is_project_admin(project_id))
  with check (private.is_project_admin(project_id));

create policy project_members_delete on public.project_members
  for delete to authenticated
  using (private.is_project_admin(project_id));

create policy project_invites_all on public.project_invites
  for all to authenticated
  using (private.is_project_admin(project_id))
  with check (private.is_project_admin(project_id));

-- ---------------------------------------------------------------------------
-- BOQ & master data
-- ---------------------------------------------------------------------------
create policy boq_items_select on public.boq_items
  for select to authenticated
  using (private.can_read_project(project_id));

create policy boq_items_write on public.boq_items
  for all to authenticated
  using (private.is_project_admin(project_id))
  with check (private.is_project_admin(project_id));

-- Harga satuan: Admin saja.
create policy boq_item_prices_admin on public.boq_item_prices
  for all to authenticated
  using (
    private.is_project_admin((select b.project_id from public.boq_items b where b.id = boq_item_id))
  )
  with check (
    private.is_project_admin((select b.project_id from public.boq_items b where b.id = boq_item_id))
  );

create policy master_items_select on public.master_items
  for select to authenticated
  using (private.can_read_project(project_id));

-- Pelaksana boleh menambah cepat dari form.
create policy master_items_insert on public.master_items
  for insert to authenticated
  with check (
    private.is_project_admin(project_id)
    or private.project_role(project_id) = 'pelaksana'
  );

create policy master_items_update on public.master_items
  for update to authenticated
  using (private.is_project_admin(project_id))
  with check (private.is_project_admin(project_id));

create policy master_items_delete on public.master_items
  for delete to authenticated
  using (private.is_project_admin(project_id));

-- ---------------------------------------------------------------------------
-- Laporan
-- Perubahan status hanya lewat fungsi security definer (migrasi berikutnya).
-- Hak kolom di bawah mencegah klien mengubah status atau kolom review.
-- ---------------------------------------------------------------------------
-- Logika sama dengan private.can_read_report / can_edit_report, tapi memakai kolom
-- baris langsung agar INSERT ... RETURNING dan UPDATE melihat nilai yang benar.
create policy reports_select on public.reports
  for select to authenticated
  using (
    author_id = (select auth.uid())
    or private.is_project_admin(project_id)
    or (status <> 'draft' and private.project_role(project_id) = 'pengawas')
  );

create policy reports_insert on public.reports
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'draft'
    and private.project_role(project_id) = 'pelaksana'
  );

create policy reports_update on public.reports
  for update to authenticated
  using (
    author_id = (select auth.uid())
    and status in ('draft', 'revision_requested')
    and private.project_role(project_id) = 'pelaksana'
  )
  with check (
    author_id = (select auth.uid())
    and status in ('draft', 'revision_requested')
    and private.project_role(project_id) = 'pelaksana'
  );

create policy reports_delete on public.reports
  for delete to authenticated
  using (author_id = (select auth.uid()) and status = 'draft');

revoke insert, update on public.reports from anon, authenticated;
grant insert (project_id, author_id, period_start, period_end, notes_raw, notes_polished)
  on public.reports to authenticated;
grant update (period_start, period_end, notes_raw, notes_polished)
  on public.reports to authenticated;

-- Tabel anak: baca mengikuti laporan, tulis hanya saat laporan bisa diedit.
create policy report_weather_select on public.report_weather
  for select to authenticated using (private.can_read_report(report_id));
create policy report_weather_write on public.report_weather
  for all to authenticated
  using (private.can_edit_report(report_id))
  with check (private.can_edit_report(report_id));

create policy report_labor_select on public.report_labor
  for select to authenticated using (private.can_read_report(report_id));
create policy report_labor_write on public.report_labor
  for all to authenticated
  using (private.can_edit_report(report_id))
  with check (private.can_edit_report(report_id));

create policy report_equipment_select on public.report_equipment
  for select to authenticated using (private.can_read_report(report_id));
create policy report_equipment_write on public.report_equipment
  for all to authenticated
  using (private.can_edit_report(report_id))
  with check (private.can_edit_report(report_id));

create policy report_materials_select on public.report_materials
  for select to authenticated using (private.can_read_report(report_id));
create policy report_materials_write on public.report_materials
  for all to authenticated
  using (private.can_edit_report(report_id))
  with check (private.can_edit_report(report_id));

create policy report_volumes_select on public.report_volumes
  for select to authenticated using (private.can_read_report(report_id));
create policy report_volumes_write on public.report_volumes
  for all to authenticated
  using (private.can_edit_report(report_id))
  with check (private.can_edit_report(report_id));

-- Kolom duplikat hanya diisi fungsi server.
revoke insert, update on public.report_volumes from anon, authenticated;
grant insert (report_id, boq_item_id, volume) on public.report_volumes to authenticated;
grant update (volume) on public.report_volumes to authenticated;

create policy report_photos_select on public.report_photos
  for select to authenticated using (private.can_read_report(report_id));
create policy report_photos_write on public.report_photos
  for all to authenticated
  using (private.can_edit_report(report_id))
  with check (private.can_edit_report(report_id));

revoke insert, update on public.report_photos from anon, authenticated;
grant insert (id, report_id, storage_path, sha256, source, taken_at, lat, lng, accuracy_m,
              boq_item_id, size_bytes, was_compressed)
  on public.report_photos to authenticated;
grant update (boq_item_id) on public.report_photos to authenticated;

-- Review hanya ditulis lewat fungsi.
create policy report_reviews_select on public.report_reviews
  for select to authenticated using (private.can_read_report(report_id));

create policy report_review_comments_select on public.report_review_comments
  for select to authenticated
  using (
    private.can_read_report((select rr.report_id from public.report_reviews rr where rr.id = review_id))
  );

-- ---------------------------------------------------------------------------
-- Notifikasi, push, AI, audit
-- ---------------------------------------------------------------------------
create policy notifications_select on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke insert, update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy ai_runs_select on public.ai_runs
  for select to authenticated using (private.is_workspace_admin(workspace_id));

create policy audit_log_select on public.audit_log
  for select to authenticated using (private.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Storage: foto laporan
-- Path: {workspace_id}/{project_id}/{report_id}/{photo_id}.{ext}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-photos',
  'report-photos',
  false,
  15728640, -- 15 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

create policy report_photos_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'report-photos'
    and private.can_read_report(private.try_uuid((storage.foldername(name))[3]))
  );

create policy report_photos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'report-photos'
    and private.can_edit_report(private.try_uuid((storage.foldername(name))[3]))
  );

create policy report_photos_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'report-photos'
    and private.can_edit_report(private.try_uuid((storage.foldername(name))[3]))
  );

create policy report_photos_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'report-photos'
    and private.can_edit_report(private.try_uuid((storage.foldername(name))[3]))
  );
