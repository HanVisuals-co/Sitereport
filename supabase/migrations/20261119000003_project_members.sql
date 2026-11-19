-- SiteReport: undangan anggota, bergabung lewat kode proyek, audit keanggotaan.
-- Lihat docs/PRD.md bagian 4.

-- ---------------------------------------------------------------------------
-- Email di profil, supaya Admin bisa mengenali anggota.
-- ---------------------------------------------------------------------------
alter table public.profiles add column email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    new.email
  );
  return new;
end;
$$;

create function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- User boleh membaca baris keanggotaannya sendiri (termasuk yang masih pending).
create policy project_members_select_own on public.project_members
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Audit otomatis untuk keanggotaan dan undangan
-- ---------------------------------------------------------------------------
create function private.audit_project_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_project  uuid;
  row_ws       uuid;
  row_id       uuid;
  before_json  jsonb;
  after_json   jsonb;
begin
  if tg_op = 'DELETE' then
    row_project := old.project_id;
    before_json := to_jsonb(old);
  else
    row_project := new.project_id;
    after_json := to_jsonb(new);
    if tg_op = 'UPDATE' then
      before_json := to_jsonb(old);
    end if;
  end if;

  -- Jangan simpan hash token di audit log.
  before_json := before_json - 'token_hash';
  after_json := after_json - 'token_hash';

  select workspace_id into row_ws from public.projects where id = row_project;
  -- Proyek sedang dihapus (cascade): tidak perlu dicatat.
  if row_ws is null then
    return null;
  end if;

  if tg_table_name = 'project_members' then
    row_id := coalesce(new.user_id, old.user_id);
  else
    row_id := coalesce(new.id, old.id);
  end if;

  insert into public.audit_log (workspace_id, project_id, actor_id, entity, entity_id, action, before, after)
  values (row_ws, row_project, (select auth.uid()), tg_table_name, row_id, lower(tg_op), before_json, after_json);

  return null;
end;
$$;

create trigger project_members_audit
  after insert or update or delete on public.project_members
  for each row execute function private.audit_project_change();

create trigger project_invites_audit
  after insert or update or delete on public.project_invites
  for each row execute function private.audit_project_change();

-- ---------------------------------------------------------------------------
-- Notifikasi (ditulis oleh fungsi server)
-- ---------------------------------------------------------------------------
create function private.notify(p_user uuid, p_type text, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, payload) values (p_user, p_type, p_payload);
$$;

-- ---------------------------------------------------------------------------
-- Undangan
-- ---------------------------------------------------------------------------

-- Admin membuat link undangan. Mengembalikan token mentah (hanya sekali; yang disimpan hash-nya).
create function public.create_project_invite(
  p_project_id uuid,
  p_role public.project_role,
  p_max_uses int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text;
begin
  if not private.is_project_admin(p_project_id) then
    raise exception 'Hanya Admin yang bisa membuat undangan' using errcode = '42501';
  end if;

  if p_role not in ('pengawas', 'pelaksana') then
    raise exception 'Peran undangan harus Pengawas atau Pelaksana' using errcode = '22023';
  end if;

  raw_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.project_invites (project_id, role, token_hash, max_uses, created_by)
  values (
    p_project_id,
    p_role,
    encode(sha256(convert_to(raw_token, 'UTF8')), 'hex'),
    p_max_uses,
    (select auth.uid())
  );

  return raw_token;
end;
$$;

-- Info undangan untuk halaman gabung, sebelum user menerima.
create function public.preview_project_invite(p_token text)
returns table (
  project_name    text,
  workspace_name  text,
  role            public.project_role,
  is_valid        boolean,
  already_member  boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pr.name,
    ws.name,
    inv.role,
    inv.revoked_at is null
      and inv.expires_at > now()
      and (inv.max_uses is null or inv.used_count < inv.max_uses),
    exists (
      select 1 from public.project_members pm
      where pm.project_id = pr.id and pm.user_id = (select auth.uid()) and pm.status = 'active'
    )
  from public.project_invites inv
  join public.projects pr on pr.id = inv.project_id
  join public.workspaces ws on ws.id = pr.workspace_id
  where inv.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and (select auth.uid()) is not null;
$$;

-- Terima undangan. Mengembalikan project_id.
create function public.accept_project_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := (select auth.uid());
  inv  public.project_invites%rowtype;
  existing public.project_members%rowtype;
begin
  if uid is null then
    raise exception 'Harus login' using errcode = '42501';
  end if;

  select * into inv
  from public.project_invites
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  for update;

  if not found
     or inv.revoked_at is not null
     or inv.expires_at <= now()
     or (inv.max_uses is not null and inv.used_count >= inv.max_uses) then
    raise exception 'Undangan tidak valid atau sudah kedaluwarsa' using errcode = 'P0002';
  end if;

  select * into existing
  from public.project_members
  where project_id = inv.project_id and user_id = uid;

  if found and existing.status = 'active' then
    -- Sudah anggota: tidak mengubah peran, tidak memakai kuota undangan.
    return inv.project_id;
  end if;

  if found then
    update public.project_members
    set status = 'active', role = inv.role, invited_by = inv.created_by
    where project_id = inv.project_id and user_id = uid;
  else
    insert into public.project_members (project_id, user_id, role, status, invited_by)
    values (inv.project_id, uid, inv.role, 'active', inv.created_by);
  end if;

  update public.project_invites set used_count = used_count + 1 where id = inv.id;

  return inv.project_id;
end;
$$;

create function public.revoke_project_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv_project uuid;
begin
  select project_id into inv_project from public.project_invites where id = p_invite_id;
  if inv_project is null or not private.is_project_admin(inv_project) then
    raise exception 'Undangan tidak ditemukan' using errcode = '42501';
  end if;

  update public.project_invites
  set revoked_at = now()
  where id = p_invite_id and revoked_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Kode proyek (butuh persetujuan Admin)
-- ---------------------------------------------------------------------------
create function public.request_join_by_code(p_code text)
returns table (project_name text, workspace_name text, status public.member_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  proj  public.projects%rowtype;
  ws_name text;
  current_status public.member_status;
  admin_id uuid;
begin
  if uid is null then
    raise exception 'Harus login' using errcode = '42501';
  end if;

  -- Kolom diberi alias tabel: "status" juga nama kolom output fungsi ini.
  select p.* into proj
  from public.projects p
  where p.join_code = upper(trim(p_code)) and p.status = 'active';

  if not found then
    raise exception 'Kode proyek tidak ditemukan' using errcode = 'P0002';
  end if;

  select name into ws_name from public.workspaces where id = proj.workspace_id;

  select pm.status into current_status
  from public.project_members pm
  where pm.project_id = proj.id and pm.user_id = uid;

  if current_status is null then
    -- Peran final ditentukan Admin saat menyetujui.
    insert into public.project_members (project_id, user_id, role, status)
    values (proj.id, uid, 'pelaksana', 'pending');
    current_status := 'pending';

    for admin_id in
      select wa.user_id from public.workspace_admins wa where wa.workspace_id = proj.workspace_id
    loop
      perform private.notify(
        admin_id,
        'join_request',
        jsonb_build_object('project_id', proj.id, 'project_name', proj.name, 'user_id', uid)
      );
    end loop;
  end if;

  return query select proj.name, ws_name, current_status;
end;
$$;

create function public.approve_join_request(
  p_project_id uuid,
  p_user_id uuid,
  p_role public.project_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  proj_name text;
begin
  if not private.is_project_admin(p_project_id) then
    raise exception 'Hanya Admin yang bisa menyetujui' using errcode = '42501';
  end if;

  if p_role not in ('pengawas', 'pelaksana') then
    raise exception 'Peran harus Pengawas atau Pelaksana' using errcode = '22023';
  end if;

  update public.project_members
  set status = 'active', role = p_role, invited_by = (select auth.uid())
  where project_id = p_project_id and user_id = p_user_id and status = 'pending';

  if not found then
    raise exception 'Permintaan tidak ditemukan' using errcode = 'P0002';
  end if;

  select name into proj_name from public.projects where id = p_project_id;
  perform private.notify(
    p_user_id,
    'join_approved',
    jsonb_build_object('project_id', p_project_id, 'project_name', proj_name, 'role', p_role)
  );
end;
$$;

create function public.reject_join_request(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_project_admin(p_project_id) then
    raise exception 'Hanya Admin yang bisa menolak' using errcode = '42501';
  end if;

  delete from public.project_members
  where project_id = p_project_id and user_id = p_user_id and status = 'pending';
end;
$$;

-- Permintaan bergabung milik user yang masih menunggu (untuk beranda).
create function public.my_pending_join_requests()
returns table (project_name text, workspace_name text, requested_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.name, ws.name, pm.created_at
  from public.project_members pm
  join public.projects pr on pr.id = pm.project_id
  join public.workspaces ws on ws.id = pr.workspace_id
  where pm.user_id = (select auth.uid()) and pm.status = 'pending'
  order by pm.created_at desc;
$$;

-- Ganti kode proyek (misalnya kalau bocor).
create function public.regenerate_join_code(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_code text;
begin
  if not private.is_project_admin(p_project_id) then
    raise exception 'Hanya Admin yang bisa mengganti kode' using errcode = '42501';
  end if;

  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update public.projects set join_code = new_code where id = p_project_id;
  return new_code;
end;
$$;

-- Fungsi RPC hanya untuk user yang login.
revoke execute on function
  public.create_project_invite(uuid, public.project_role, int),
  public.preview_project_invite(text),
  public.accept_project_invite(text),
  public.revoke_project_invite(uuid),
  public.request_join_by_code(text),
  public.approve_join_request(uuid, uuid, public.project_role),
  public.reject_join_request(uuid, uuid),
  public.my_pending_join_requests(),
  public.regenerate_join_code(uuid)
from public, anon;

grant execute on function
  public.create_project_invite(uuid, public.project_role, int),
  public.preview_project_invite(text),
  public.accept_project_invite(text),
  public.revoke_project_invite(uuid),
  public.request_join_by_code(text),
  public.approve_join_request(uuid, uuid, public.project_role),
  public.reject_join_request(uuid, uuid),
  public.my_pending_join_requests(),
  public.regenerate_join_code(uuid)
to authenticated;
