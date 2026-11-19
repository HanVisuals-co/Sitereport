-- SiteReport: alur laporan harian (periode, draft, submit, review, kunci, duplikat).
-- Lihat docs/PRD.md bagian 6.3–6.6 dan docs/ARCHITECTURE.md bagian 4.

-- ---------------------------------------------------------------------------
-- Periode
-- ---------------------------------------------------------------------------

-- Tanggal hari ini menurut zona waktu proyek.
create function private.project_today(p_project_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone timezone)::date from public.projects where id = p_project_id;
$$;

-- Awal periode yang memuat tanggal p_date. Periode dihitung dari tanggal mulai proyek
-- (atau tanggal proyek dibuat) dengan panjang report_period_days.
create function private.period_start_for(p_project_id uuid, p_date date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when pr.report_period_days = 1 then p_date
    else anchor + (floor((p_date - anchor)::numeric / pr.report_period_days) * pr.report_period_days)::int
  end
  from public.projects pr,
       lateral (select coalesce(pr.start_date, (pr.created_at at time zone pr.timezone)::date) as anchor) a
  where pr.id = p_project_id;
$$;

-- Admin membuka akses lapor terlambat di luar batas untuk satu Pelaksana & periode.
create table public.report_backdate_unlocks (
  project_id    uuid not null references public.projects (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  period_start  date not null,
  unlocked_by   uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  primary key (project_id, user_id, period_start)
);

alter table public.report_backdate_unlocks enable row level security;

create policy report_backdate_unlocks_select on public.report_backdate_unlocks
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_project_admin(project_id));

create function public.unlock_backdate(p_project_id uuid, p_user_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_project_admin(p_project_id) then
    raise exception 'Hanya Admin yang bisa membuka akses' using errcode = '42501';
  end if;
  insert into public.report_backdate_unlocks (project_id, user_id, period_start, unlocked_by)
  values (p_project_id, p_user_id, private.period_start_for(p_project_id, p_date), (select auth.uid()))
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Kunci laporan Approved
-- Fungsi server yang boleh mengubah laporan terkunci menyalakan GUC sitereport.allow_locked.
-- ---------------------------------------------------------------------------
create function private.allow_locked() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('sitereport.allow_locked', true), '') = 'on';
$$;

create function private.guard_locked_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'approved' and not private.allow_locked()
     -- Proyek sedang dihapus (cascade): izinkan.
     and exists (select 1 from public.projects where id = old.project_id) then
    raise exception 'Laporan sudah disetujui dan terkunci' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger reports_guard_locked
  before update or delete on public.reports
  for each row execute function private.guard_locked_report();

create function private.guard_locked_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid := coalesce(new.report_id, old.report_id);
  st  public.report_status;
begin
  if private.allow_locked() then
    return coalesce(new, old);
  end if;
  -- Laporan tidak ditemukan = sedang dihapus (cascade): izinkan.
  select status into st from public.reports where id = rid;
  if st = 'approved' then
    raise exception 'Laporan sudah disetujui dan terkunci' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger report_weather_guard before insert or update or delete on public.report_weather
  for each row execute function private.guard_locked_child();
create trigger report_labor_guard before insert or update or delete on public.report_labor
  for each row execute function private.guard_locked_child();
create trigger report_equipment_guard before insert or update or delete on public.report_equipment
  for each row execute function private.guard_locked_child();
create trigger report_materials_guard before insert or update or delete on public.report_materials
  for each row execute function private.guard_locked_child();
create trigger report_volumes_guard before insert or update or delete on public.report_volumes
  for each row execute function private.guard_locked_child();
create trigger report_photos_guard before insert or update or delete on public.report_photos
  for each row execute function private.guard_locked_child();

-- ---------------------------------------------------------------------------
-- Membuat / membuka draft
-- ---------------------------------------------------------------------------
create function public.start_report(p_project_id uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := (select auth.uid());
  proj    public.projects%rowtype;
  today   date;
  ps      date;
  pe      date;
  rid     uuid;
begin
  if private.project_role(p_project_id) is distinct from 'pelaksana' then
    raise exception 'Hanya Pelaksana proyek yang bisa membuat laporan' using errcode = '42501';
  end if;

  select * into proj from public.projects where id = p_project_id;
  if proj.status <> 'active' then
    raise exception 'Proyek sudah diarsipkan' using errcode = '22023';
  end if;
  if not exists (select 1 from public.boq_items where project_id = p_project_id) then
    raise exception 'BOQ proyek belum diisi' using errcode = '22023';
  end if;

  today := private.project_today(p_project_id);
  if p_date > today then
    raise exception 'Tanggal laporan tidak boleh di masa depan' using errcode = '22023';
  end if;

  ps := private.period_start_for(p_project_id, p_date);
  pe := ps + proj.report_period_days - 1;

  select id into rid from public.reports
  where project_id = p_project_id and author_id = uid and period_start = ps;
  if rid is not null then
    return rid;
  end if;

  if today - pe > proj.backdate_limit_days and not exists (
    select 1 from public.report_backdate_unlocks
    where project_id = p_project_id and user_id = uid and period_start = ps
  ) then
    raise exception 'Lewat batas lapor terlambat (% hari). Minta Admin membuka akses.',
      proj.backdate_limit_days using errcode = '22023';
  end if;

  insert into public.reports (project_id, author_id, period_start, period_end)
  values (p_project_id, uid, ps, pe)
  returning id into rid;
  return rid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Simpan isi draft (atomik). Foto disimpan terpisah.
-- p_data: { notes_raw, notes_polished,
--   weather: [{slot, condition, rain_hours}],
--   labor: [{master_item_id, count}],
--   equipment: [{master_item_id, count, hours}],
--   materials: [{master_item_id, quantity}],
--   volumes: [{boq_item_id, volume}] }
-- ---------------------------------------------------------------------------
create function public.save_report_draft(p_report_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rep public.reports%rowtype;
  leaf_count int;
begin
  if not private.can_edit_report(p_report_id) then
    raise exception 'Laporan tidak bisa diubah' using errcode = '42501';
  end if;
  select * into rep from public.reports where id = p_report_id;

  update public.reports
  set notes_raw = nullif(trim(p_data ->> 'notes_raw'), ''),
      notes_polished = nullif(trim(p_data ->> 'notes_polished'), '')
  where id = p_report_id;

  delete from public.report_weather where report_id = p_report_id;
  insert into public.report_weather (report_id, slot, condition, rain_hours)
  select p_report_id, (w ->> 'slot')::public.weather_slot, (w ->> 'condition')::public.weather_cond,
         coalesce((w ->> 'rain_hours')::numeric, 0)
  from jsonb_array_elements(coalesce(p_data -> 'weather', '[]')) w;

  delete from public.report_labor where report_id = p_report_id;
  insert into public.report_labor (report_id, master_item_id, count)
  select p_report_id, (x ->> 'master_item_id')::uuid, (x ->> 'count')::int
  from jsonb_array_elements(coalesce(p_data -> 'labor', '[]')) x
  where (x ->> 'count')::int > 0;

  delete from public.report_equipment where report_id = p_report_id;
  insert into public.report_equipment (report_id, master_item_id, count, hours)
  select p_report_id, (x ->> 'master_item_id')::uuid, (x ->> 'count')::int,
         coalesce((x ->> 'hours')::numeric, 0)
  from jsonb_array_elements(coalesce(p_data -> 'equipment', '[]')) x
  where (x ->> 'count')::int > 0;

  delete from public.report_materials where report_id = p_report_id;
  insert into public.report_materials (report_id, master_item_id, quantity)
  select p_report_id, (x ->> 'master_item_id')::uuid, (x ->> 'quantity')::numeric
  from jsonb_array_elements(coalesce(p_data -> 'materials', '[]')) x
  where (x ->> 'quantity')::numeric > 0;

  -- Volume hanya untuk item daun BOQ proyek ini.
  select count(*) into leaf_count
  from jsonb_array_elements(coalesce(p_data -> 'volumes', '[]')) x
  join public.boq_items b on b.id = (x ->> 'boq_item_id')::uuid
  where exists (select 1 from public.boq_items c where c.parent_id = b.id);
  if leaf_count > 0 then
    raise exception 'Volume hanya bisa diisi untuk item BOQ terbawah' using errcode = '22023';
  end if;

  delete from public.report_volumes where report_id = p_report_id;
  insert into public.report_volumes (report_id, boq_item_id, volume)
  select p_report_id, (x ->> 'boq_item_id')::uuid, (x ->> 'volume')::numeric
  from jsonb_array_elements(coalesce(p_data -> 'volumes', '[]')) x
  where (x ->> 'volume')::numeric > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Submit
-- ---------------------------------------------------------------------------
create function public.submit_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rep       public.reports%rowtype;
  proj_name text;
  today     date;
  dup_vol   int;
  dup_photo int;
  over      jsonb;
  reviewer  uuid;
begin
  if not private.can_edit_report(p_report_id) then
    raise exception 'Laporan tidak bisa dikirim' using errcode = '42501';
  end if;
  select * into rep from public.reports where id = p_report_id;

  if not exists (select 1 from public.report_photos where report_id = p_report_id) then
    raise exception 'Tambahkan minimal 1 foto' using errcode = '22023';
  end if;
  if (select count(*) from public.report_weather where report_id = p_report_id) < 3 then
    raise exception 'Isi cuaca pagi, siang, dan sore' using errcode = '22023';
  end if;

  -- Cek duplikat ulang dari nol (laporan revisi bisa sudah berubah).
  update public.report_volumes rv
  set dup_flag = false, dup_of_report_id = null, dup_resolution = null, dup_resolved_by = null
  where rv.report_id = p_report_id;

  update public.report_volumes rv
  set dup_flag = true,
      dup_of_report_id = (
        select o.report_id
        from public.report_volumes o
        join public.reports orep on orep.id = o.report_id
        where o.boq_item_id = rv.boq_item_id
          and o.report_id <> p_report_id
          and orep.project_id = rep.project_id
          and orep.author_id <> rep.author_id
          and orep.status in ('submitted', 'approved')
          and orep.period_start <= rep.period_end
          and orep.period_end >= rep.period_start
          and o.volume > 0
          and abs(o.volume - rv.volume) <= 0.01 * greatest(o.volume, rv.volume)
        limit 1
      )
  where rv.report_id = p_report_id and rv.volume > 0;
  update public.report_volumes set dup_flag = false
  where report_id = p_report_id and dup_of_report_id is null;

  update public.report_photos p
  set dup_flag = exists (
        select 1 from public.report_photos o
        join public.reports orep on orep.id = o.report_id
        where o.sha256 = p.sha256
          and o.report_id <> p_report_id
          and orep.project_id = rep.project_id
          and orep.status <> 'draft'
      ),
      dup_resolution = null
  where p.report_id = p_report_id;

  select count(*) into dup_vol from public.report_volumes where report_id = p_report_id and dup_flag;
  select count(*) into dup_photo from public.report_photos where report_id = p_report_id and dup_flag;

  -- Volume kumulatif (approved + laporan ini) yang melebihi volume kontrak: peringatan saja.
  select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', b.id, 'name', b.name)), '[]'::jsonb)
  into over
  from public.report_volumes rv
  join public.boq_items b on b.id = rv.boq_item_id
  where rv.report_id = p_report_id
    and b.contract_volume is not null
    and rv.volume + coalesce((
      select sum(o.volume) from public.report_volumes o
      join public.reports orep on orep.id = o.report_id
      where o.boq_item_id = b.id and orep.status = 'approved'
        and o.dup_resolution is distinct from 'duplicate'
    ), 0) > b.contract_volume;

  today := private.project_today(rep.project_id);
  update public.reports
  set status = 'submitted', submitted_at = now(), is_late = today > rep.period_end
  where id = p_report_id;

  select name into proj_name from public.projects where id = rep.project_id;
  for reviewer in
    select user_id from public.project_members
    where project_id = rep.project_id and role = 'pengawas' and status = 'active'
      and user_id <> rep.author_id
  loop
    perform private.notify(reviewer, 'report_submitted', jsonb_build_object(
      'report_id', p_report_id, 'project_id', rep.project_id, 'project_name', proj_name,
      'period_start', rep.period_start, 'duplicates', dup_vol + dup_photo));
  end loop;

  return jsonb_build_object('duplicates', dup_vol + dup_photo, 'over_contract', over);
end;
$$;

-- ---------------------------------------------------------------------------
-- Review (Pengawas) dan buka ulang (Admin)
-- ---------------------------------------------------------------------------
create function private.assert_reviewer(p_report public.reports)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.project_role(p_report.project_id) is distinct from 'pengawas' then
    raise exception 'Hanya Pengawas proyek yang bisa mereview' using errcode = '42501';
  end if;
  if p_report.author_id = (select auth.uid()) then
    raise exception 'Tidak bisa mereview laporan sendiri' using errcode = '42501';
  end if;
  if p_report.status <> 'submitted' then
    raise exception 'Laporan tidak sedang menunggu review' using errcode = '22023';
  end if;
end;
$$;

create function public.resolve_duplicate(
  p_report_id uuid,
  p_kind text,
  p_ref uuid,
  p_resolution public.dup_resolution
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rep public.reports%rowtype;
begin
  select * into rep from public.reports where id = p_report_id;
  if not found then
    raise exception 'Laporan tidak ditemukan' using errcode = 'P0002';
  end if;
  perform private.assert_reviewer(rep);

  if p_kind = 'volume' then
    update public.report_volumes
    set dup_resolution = p_resolution, dup_resolved_by = (select auth.uid())
    where report_id = p_report_id and boq_item_id = p_ref and dup_flag;
  elsif p_kind = 'photo' then
    update public.report_photos
    set dup_resolution = p_resolution
    where report_id = p_report_id and id = p_ref and dup_flag;
  else
    raise exception 'Jenis duplikat tidak dikenal' using errcode = '22023';
  end if;
  if not found then
    raise exception 'Flag duplikat tidak ditemukan' using errcode = 'P0002';
  end if;
end;
$$;

create function public.approve_report(p_report_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rep public.reports%rowtype;
  uid uuid := (select auth.uid());
begin
  select * into rep from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Laporan tidak ditemukan' using errcode = 'P0002';
  end if;
  perform private.assert_reviewer(rep);

  if exists (select 1 from public.report_volumes where report_id = p_report_id and dup_flag and dup_resolution is null)
     or exists (select 1 from public.report_photos where report_id = p_report_id and dup_flag and dup_resolution is null) then
    raise exception 'Putuskan semua flag duplikat dulu' using errcode = '22023';
  end if;
  if exists (select 1 from public.report_volumes where report_id = p_report_id and dup_resolution = 'duplicate')
     or exists (select 1 from public.report_photos where report_id = p_report_id and dup_resolution = 'duplicate') then
    raise exception 'Ada data yang diputuskan duplikat. Minta revisi.' using errcode = '22023';
  end if;

  update public.reports
  set status = 'approved', approved_at = now(), approved_by = uid
  where id = p_report_id;

  insert into public.report_reviews (report_id, reviewer_id, action, note)
  values (p_report_id, uid, 'approve', nullif(trim(p_note), ''));

  perform private.notify(rep.author_id, 'report_approved', jsonb_build_object(
    'report_id', p_report_id, 'project_id', rep.project_id, 'period_start', rep.period_start));
end;
$$;

create function public.request_revision(
  p_report_id uuid,
  p_note text,
  p_comments jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rep public.reports%rowtype;
  uid uuid := (select auth.uid());
  rid uuid;
begin
  select * into rep from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Laporan tidak ditemukan' using errcode = 'P0002';
  end if;
  perform private.assert_reviewer(rep);

  if coalesce(trim(p_note), '') = '' and jsonb_array_length(coalesce(p_comments, '[]')) = 0 then
    raise exception 'Tulis catatan revisi' using errcode = '22023';
  end if;

  update public.reports set status = 'revision_requested' where id = p_report_id;

  insert into public.report_reviews (report_id, reviewer_id, action, note)
  values (p_report_id, uid, 'request_revision', nullif(trim(p_note), ''))
  returning id into rid;

  insert into public.report_review_comments (review_id, section, comment)
  select rid, c ->> 'section', c ->> 'comment'
  from jsonb_array_elements(coalesce(p_comments, '[]')) c
  where coalesce(trim(c ->> 'comment'), '') <> '';

  perform private.notify(rep.author_id, 'revision_requested', jsonb_build_object(
    'report_id', p_report_id, 'project_id', rep.project_id, 'period_start', rep.period_start));
end;
$$;

create function public.reopen_report(p_report_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rep public.reports%rowtype;
  uid uuid := (select auth.uid());
begin
  select * into rep from public.reports where id = p_report_id for update;
  if not found or not private.is_project_admin(rep.project_id) then
    raise exception 'Hanya Admin yang bisa membuka ulang laporan' using errcode = '42501';
  end if;
  if rep.status <> 'approved' then
    raise exception 'Hanya laporan yang sudah disetujui yang bisa dibuka ulang' using errcode = '22023';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Tulis alasan membuka ulang' using errcode = '22023';
  end if;

  perform set_config('sitereport.allow_locked', 'on', true);
  update public.reports
  set status = 'revision_requested', approved_at = null, approved_by = null
  where id = p_report_id;
  perform set_config('sitereport.allow_locked', 'off', true);

  insert into public.report_reviews (report_id, reviewer_id, action, note)
  values (p_report_id, uid, 'reopen', trim(p_note));

  insert into public.audit_log (workspace_id, project_id, actor_id, entity, entity_id, action, after)
  select pr.workspace_id, rep.project_id, uid, 'reports', p_report_id, 'reopen',
         jsonb_build_object('note', trim(p_note))
  from public.projects pr where pr.id = rep.project_id;

  perform private.notify(rep.author_id, 'report_reopened', jsonb_build_object(
    'report_id', p_report_id, 'project_id', rep.project_id, 'period_start', rep.period_start));
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak akses fungsi
-- ---------------------------------------------------------------------------
revoke execute on function
  public.unlock_backdate(uuid, uuid, date),
  public.start_report(uuid, date),
  public.save_report_draft(uuid, jsonb),
  public.submit_report(uuid),
  public.resolve_duplicate(uuid, text, uuid, public.dup_resolution),
  public.approve_report(uuid, text),
  public.request_revision(uuid, text, jsonb),
  public.reopen_report(uuid, text)
from public, anon;

grant execute on function
  public.unlock_backdate(uuid, uuid, date),
  public.start_report(uuid, date),
  public.save_report_draft(uuid, jsonb),
  public.submit_report(uuid),
  public.resolve_duplicate(uuid, text, uuid, public.dup_resolution),
  public.approve_report(uuid, text),
  public.request_revision(uuid, text, jsonb),
  public.reopen_report(uuid, text)
to authenticated;

-- Klien tidak boleh langsung membuat laporan; harus lewat start_report (cek periode & batas).
drop policy reports_insert on public.reports;
