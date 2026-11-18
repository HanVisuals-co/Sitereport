-- SiteReport: skema awal (tenancy, BOQ, master data, laporan, notifikasi, audit).
-- Lihat docs/ARCHITECTURE.md bagian 3.

-- Schema untuk fungsi internal. Tidak diekspos lewat Data API.
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
create type public.project_role   as enum ('pengawas', 'pelaksana', 'viewer');
create type public.member_status  as enum ('pending', 'active');
create type public.project_status as enum ('active', 'archived');
create type public.report_status  as enum ('draft', 'submitted', 'revision_requested', 'approved');
create type public.master_kind    as enum ('labor', 'equipment', 'material');
create type public.weather_slot   as enum ('pagi', 'siang', 'sore');
create type public.weather_cond   as enum ('cerah', 'berawan', 'hujan');
create type public.photo_source   as enum ('camera', 'gallery');
create type public.review_action  as enum ('approve', 'request_revision', 'reopen');
create type public.dup_resolution as enum ('valid', 'duplicate');
create type public.weight_source  as enum ('auto', 'manual');

-- ---------------------------------------------------------------------------
-- Utilitas
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identitas & tenancy
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Buat profil otomatis saat user baru mendaftar (Google atau email).
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);

create table public.workspace_admins (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_admins_user_idx on public.workspace_admins (user_id);

-- Pembuat workspace otomatis menjadi Admin.
create function private.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_admins (workspace_id, user_id)
  values (new.id, new.created_by);
  return new;
end;
$$;

create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function private.handle_new_workspace();

create table public.projects (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  name                 text not null check (char_length(name) between 1 and 200),
  code                 text,
  location             text,
  timezone             text not null default 'Asia/Jakarta'
                       check (timezone in ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura')),
  status               public.project_status not null default 'active',
  report_period_days   int not null default 1 check (report_period_days between 1 and 31),
  backdate_limit_days  int not null default 2 check (backdate_limit_days between 0 and 60),
  reminder_time        time not null default '17:00',
  join_code            text not null unique
                       default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  start_date           date,
  end_date             date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (start_date is null or end_date is null or end_date >= start_date)
);

create index projects_workspace_idx on public.projects (workspace_id);

create trigger projects_updated_at
  before update on public.projects
  for each row execute function private.set_updated_at();

create table public.project_members (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.project_role not null,
  status      public.member_status not null default 'active',
  invited_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members (user_id);

create table public.project_invites (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  role        public.project_role not null,
  -- Hanya hash token yang disimpan. Token mentah hanya ada di link undangan.
  token_hash  text not null unique,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  max_uses    int check (max_uses is null or max_uses > 0),
  used_count  int not null default 0 check (used_count >= 0),
  created_by  uuid not null references public.profiles (id),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index project_invites_project_idx on public.project_invites (project_id);

-- ---------------------------------------------------------------------------
-- BOQ & master data
-- ---------------------------------------------------------------------------
create table public.boq_items (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  parent_id        uuid references public.boq_items (id) on delete cascade,
  level            smallint not null check (level between 1 and 3),
  code             text,
  name             text not null check (char_length(name) between 1 and 500),
  sort_order       int not null default 0,
  -- unit dan contract_volume diisi untuk item daun (tanpa anak).
  unit             text,
  contract_volume  numeric(18, 4) check (contract_volume is null or contract_volume >= 0),
  weight_pct       numeric(9, 6) check (weight_pct is null or weight_pct between 0 and 100),
  weight_source    public.weight_source not null default 'auto',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((level = 1) = (parent_id is null))
);

create index boq_items_project_idx on public.boq_items (project_id);
create index boq_items_parent_idx on public.boq_items (parent_id);

create trigger boq_items_updated_at
  before update on public.boq_items
  for each row execute function private.set_updated_at();

-- Induk harus berada di proyek yang sama dan tepat satu level di atasnya.
create function private.boq_items_check_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_project uuid;
  parent_level   smallint;
begin
  if new.parent_id is null then
    return new;
  end if;

  select project_id, level into parent_project, parent_level
  from public.boq_items
  where id = new.parent_id;

  if parent_project is distinct from new.project_id then
    raise exception 'Induk BOQ harus berada di proyek yang sama';
  end if;

  if new.level <> parent_level + 1 then
    raise exception 'Level BOQ harus satu tingkat di bawah induknya';
  end if;

  return new;
end;
$$;

create trigger boq_items_check_parent
  before insert or update of parent_id, level, project_id on public.boq_items
  for each row execute function private.boq_items_check_parent();

-- Harga dipisah dari boq_items supaya RLS bisa membatasinya ke Admin.
create table public.boq_item_prices (
  boq_item_id  uuid primary key references public.boq_items (id) on delete cascade,
  unit_price   numeric(18, 2) not null check (unit_price >= 0),
  updated_at   timestamptz not null default now()
);

create trigger boq_item_prices_updated_at
  before update on public.boq_item_prices
  for each row execute function private.set_updated_at();

create table public.master_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  kind        public.master_kind not null,
  name        text not null check (char_length(name) between 1 and 200),
  unit        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  -- Target composite FK dari tabel report_* agar jenis master selalu cocok.
  unique (id, kind)
);

create unique index master_items_unique_name
  on public.master_items (project_id, kind, lower(name));

-- ---------------------------------------------------------------------------
-- Laporan
-- ---------------------------------------------------------------------------
create table public.reports (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects (id) on delete cascade,
  author_id             uuid not null references public.profiles (id),
  -- Tanggal lokal proyek.
  period_start          date not null,
  period_end            date not null,
  status                public.report_status not null default 'draft',
  is_late               boolean not null default false,
  notes_raw             text,
  notes_polished        text,
  submitted_at          timestamptz,
  approved_at           timestamptz,
  approved_by           uuid references public.profiles (id),
  backdate_unlocked_by  uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (period_end >= period_start),
  unique (project_id, author_id, period_start)
);

create index reports_project_period_idx on public.reports (project_id, period_start);
create index reports_author_idx on public.reports (author_id);

create trigger reports_updated_at
  before update on public.reports
  for each row execute function private.set_updated_at();

create table public.report_weather (
  report_id   uuid not null references public.reports (id) on delete cascade,
  slot        public.weather_slot not null,
  condition   public.weather_cond not null,
  rain_hours  numeric(4, 1) not null default 0 check (rain_hours between 0 and 24),
  primary key (report_id, slot)
);

create table public.report_labor (
  report_id       uuid not null references public.reports (id) on delete cascade,
  master_item_id  uuid not null,
  kind            public.master_kind not null default 'labor' check (kind = 'labor'),
  count           int not null check (count >= 0),
  primary key (report_id, master_item_id),
  -- Deferred: hapus proyek (cascade) tetap jalan, hapus master yang dipakai tetap ditolak.
  foreign key (master_item_id, kind) references public.master_items (id, kind)
    deferrable initially deferred
);

create table public.report_equipment (
  report_id       uuid not null references public.reports (id) on delete cascade,
  master_item_id  uuid not null,
  kind            public.master_kind not null default 'equipment' check (kind = 'equipment'),
  count           int not null check (count >= 0),
  hours           numeric(6, 2) not null default 0 check (hours >= 0),
  primary key (report_id, master_item_id),
  -- Deferred: hapus proyek (cascade) tetap jalan, hapus master yang dipakai tetap ditolak.
  foreign key (master_item_id, kind) references public.master_items (id, kind)
    deferrable initially deferred
);

create table public.report_materials (
  report_id       uuid not null references public.reports (id) on delete cascade,
  master_item_id  uuid not null,
  kind            public.master_kind not null default 'material' check (kind = 'material'),
  quantity        numeric(18, 4) not null check (quantity >= 0),
  primary key (report_id, master_item_id),
  -- Deferred: hapus proyek (cascade) tetap jalan, hapus master yang dipakai tetap ditolak.
  foreign key (master_item_id, kind) references public.master_items (id, kind)
    deferrable initially deferred
);

create table public.report_volumes (
  report_id         uuid not null references public.reports (id) on delete cascade,
  -- Deferred: hapus proyek (cascade) tetap jalan, hapus item BOQ yang dipakai tetap ditolak.
  boq_item_id       uuid not null references public.boq_items (id)
                    deferrable initially deferred,
  volume            numeric(18, 4) not null check (volume >= 0),
  dup_flag          boolean not null default false,
  dup_of_report_id  uuid references public.reports (id) on delete set null,
  dup_resolution    public.dup_resolution,
  dup_resolved_by   uuid references public.profiles (id),
  primary key (report_id, boq_item_id)
);

create index report_volumes_boq_idx on public.report_volumes (boq_item_id);

create table public.report_photos (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references public.reports (id) on delete cascade,
  storage_path    text not null unique,
  -- SHA-256 file asli sebelum kompresi, untuk deteksi duplikat.
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source          public.photo_source not null,
  taken_at        timestamptz,
  lat             double precision check (lat is null or lat between -90 and 90),
  lng             double precision check (lng is null or lng between -180 and 180),
  accuracy_m      real,
  boq_item_id     uuid references public.boq_items (id) on delete set null,
  size_bytes      int not null check (size_bytes > 0),
  was_compressed  boolean not null default true,
  dup_flag        boolean not null default false,
  dup_resolution  public.dup_resolution,
  created_at      timestamptz not null default now()
);

create index report_photos_report_idx on public.report_photos (report_id);
create index report_photos_sha_idx on public.report_photos (sha256);

-- Semua baris anak laporan harus merujuk data dari proyek yang sama dengan laporannya.
create function private.assert_same_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_project  uuid;
  target_project  uuid;
begin
  select project_id into report_project from public.reports where id = new.report_id;

  if tg_table_name in ('report_labor', 'report_equipment', 'report_materials') then
    select project_id into target_project from public.master_items where id = new.master_item_id;
  elsif tg_table_name = 'report_volumes' then
    select project_id into target_project from public.boq_items where id = new.boq_item_id;
  elsif tg_table_name = 'report_photos' then
    if new.boq_item_id is null then
      return new;
    end if;
    select project_id into target_project from public.boq_items where id = new.boq_item_id;
  end if;

  if target_project is distinct from report_project then
    raise exception 'Data harus berasal dari proyek yang sama dengan laporan';
  end if;

  return new;
end;
$$;

create trigger report_labor_same_project
  before insert or update on public.report_labor
  for each row execute function private.assert_same_project();
create trigger report_equipment_same_project
  before insert or update on public.report_equipment
  for each row execute function private.assert_same_project();
create trigger report_materials_same_project
  before insert or update on public.report_materials
  for each row execute function private.assert_same_project();
create trigger report_volumes_same_project
  before insert or update on public.report_volumes
  for each row execute function private.assert_same_project();
create trigger report_photos_same_project
  before insert or update on public.report_photos
  for each row execute function private.assert_same_project();

create table public.report_reviews (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.reports (id) on delete cascade,
  reviewer_id  uuid not null references public.profiles (id),
  action       public.review_action not null,
  note         text,
  created_at   timestamptz not null default now()
);

create index report_reviews_report_idx on public.report_reviews (report_id);

create table public.report_review_comments (
  id         uuid primary key default gen_random_uuid(),
  review_id  uuid not null references public.report_reviews (id) on delete cascade,
  section    text not null check (section in
               ('cuaca', 'tenaga_kerja', 'alat', 'material', 'volume', 'catatan', 'foto')),
  comment    text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notifikasi, AI, audit
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null;

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Pelacakan biaya & error AI. Tidak menyimpan teks laporan.
create table public.ai_runs (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  report_id      uuid references public.reports (id) on delete set null,
  kind           text not null check (kind in ('polish', 'anomaly', 'weekly')),
  model          text not null,
  input_tokens   int,
  output_tokens  int,
  ok             boolean not null,
  error          text,
  created_at     timestamptz not null default now()
);

create index ai_runs_workspace_idx on public.ai_runs (workspace_id, created_at desc);

-- Append-only. Diisi lewat fungsi security definer.
create table public.audit_log (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  project_id    uuid references public.projects (id) on delete set null,
  actor_id      uuid references public.profiles (id),
  entity        text not null,
  entity_id     uuid,
  action        text not null,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);

create index audit_log_workspace_idx on public.audit_log (workspace_id, created_at desc);

create function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log bersifat append-only';
end;
$$;

-- Delete tidak diblokir di sini agar hapus workspace (cascade) tetap jalan.
-- User biasa tetap tidak bisa delete karena tidak ada policy delete.
create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function private.audit_log_immutable();
