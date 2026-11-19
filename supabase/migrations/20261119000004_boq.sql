-- SiteReport: BOQ sampai 6 level, spesifikasi item, import massal, bobot otomatis.
-- Lihat docs/PRD.md bagian 6.2.

-- RAB asli sampai 5 level (Disiplin > Lantai > Pekerjaan > Sub > Item); beri ruang 6.
alter table public.boq_items drop constraint boq_items_level_check;
alter table public.boq_items add constraint boq_items_level_check check (level between 1 and 6);

-- Keterangan teknis (mis. "mutu f'c 25 Mpa", "Kapasitas 6,0 m3/jam").
alter table public.boq_items add column spec text;

create index boq_items_project_sort_idx on public.boq_items (project_id, sort_order);

-- ---------------------------------------------------------------------------
-- Bobot otomatis
-- bobot item daun = (harga satuan × volume kontrak) / Σ semua item daun × 100
-- ---------------------------------------------------------------------------
create function private.recalc_boq_weights(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  total numeric;
begin
  -- Daun = item tanpa anak.
  select coalesce(sum(pr.unit_price * b.contract_volume), 0) into total
  from public.boq_items b
  join public.boq_item_prices pr on pr.boq_item_id = b.id
  where b.project_id = p_project_id
    and not exists (select 1 from public.boq_items c where c.parent_id = b.id);

  update public.boq_items b
  set weight_pct = case
    when total > 0 then coalesce(round(
      (select pr.unit_price from public.boq_item_prices pr where pr.boq_item_id = b.id)
        * b.contract_volume / total * 100, 6), 0)
    else 0
  end
  where b.project_id = p_project_id
    and b.weight_source = 'auto'
    and not exists (select 1 from public.boq_items c where c.parent_id = b.id);

  -- Grup tidak punya bobot sendiri.
  update public.boq_items b
  set weight_pct = null
  where b.project_id = p_project_id
    and b.weight_pct is not null
    and exists (select 1 from public.boq_items c where c.parent_id = b.id);
end;
$$;

-- Hitung ulang saat harga atau volume berubah. Dilewati selama import massal.
create function private.trigger_recalc_boq_weights()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid uuid;
begin
  if coalesce(current_setting('sitereport.bulk_boq', true), '') = 'on' then
    return null;
  end if;

  if tg_table_name = 'boq_item_prices' then
    select project_id into pid from public.boq_items
    where id = coalesce(new.boq_item_id, old.boq_item_id);
  else
    pid := coalesce(new.project_id, old.project_id);
  end if;

  if pid is not null then
    perform private.recalc_boq_weights(pid);
  end if;
  return null;
end;
$$;

create trigger boq_item_prices_recalc
  after insert or update or delete on public.boq_item_prices
  for each row execute function private.trigger_recalc_boq_weights();

create trigger boq_items_recalc
  after insert or delete or update of contract_volume, parent_id, weight_source on public.boq_items
  for each row execute function private.trigger_recalc_boq_weights();

-- ---------------------------------------------------------------------------
-- Import BOQ massal
-- p_items: array JSON berurutan (induk selalu sebelum anaknya):
--   { key, parent_key, level, code, name, spec, unit, volume, unit_price }
-- p_replace = true menghapus BOQ lama dulu (ditolak kalau sudah dipakai laporan).
-- Mengembalikan jumlah baris yang disimpan.
-- ---------------------------------------------------------------------------
create function public.import_boq(p_project_id uuid, p_items jsonb, p_replace boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  item      jsonb;
  ids       jsonb := '{}'::jsonb;
  new_id    uuid;
  parent_id uuid;
  n         int := 0;
  ws_id     uuid;
begin
  if not private.is_project_admin(p_project_id) then
    raise exception 'Hanya Admin yang bisa mengimport BOQ' using errcode = '42501';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'BOQ kosong' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 5000 then
    raise exception 'BOQ terlalu besar (maksimal 5000 baris)' using errcode = '22023';
  end if;

  if exists (select 1 from public.boq_items where project_id = p_project_id) then
    if not p_replace then
      raise exception 'Proyek sudah punya BOQ' using errcode = '23505';
    end if;
    if exists (
      select 1 from public.report_volumes rv
      join public.boq_items b on b.id = rv.boq_item_id
      where b.project_id = p_project_id
    ) then
      raise exception 'BOQ sudah dipakai laporan dan tidak bisa diganti' using errcode = '23503';
    end if;
  end if;

  perform set_config('sitereport.bulk_boq', 'on', true);

  if p_replace then
    delete from public.boq_items where project_id = p_project_id;
  end if;

  for item in select * from jsonb_array_elements(p_items)
  loop
    parent_id := null;
    if item ? 'parent_key' and jsonb_typeof(item -> 'parent_key') = 'string' then
      parent_id := (ids ->> (item ->> 'parent_key'))::uuid;
      if parent_id is null then
        raise exception 'Induk "%" belum ada (urutan item salah)', item ->> 'parent_key'
          using errcode = '22023';
      end if;
    end if;

    insert into public.boq_items
      (project_id, parent_id, level, code, name, spec, unit, contract_volume, sort_order)
    values (
      p_project_id,
      parent_id,
      (item ->> 'level')::smallint,
      nullif(trim(item ->> 'code'), ''),
      left(trim(item ->> 'name'), 500),
      nullif(trim(item ->> 'spec'), ''),
      nullif(trim(item ->> 'unit'), ''),
      (item ->> 'volume')::numeric,
      n
    )
    returning id into new_id;

    if item ? 'unit_price' and jsonb_typeof(item -> 'unit_price') = 'number' then
      insert into public.boq_item_prices (boq_item_id, unit_price)
      values (new_id, (item ->> 'unit_price')::numeric);
    end if;

    ids := ids || jsonb_build_object(item ->> 'key', new_id);
    n := n + 1;
  end loop;

  perform set_config('sitereport.bulk_boq', 'off', true);
  perform private.recalc_boq_weights(p_project_id);

  select workspace_id into ws_id from public.projects where id = p_project_id;
  insert into public.audit_log (workspace_id, project_id, actor_id, entity, action, after)
  values (ws_id, p_project_id, (select auth.uid()), 'boq_items',
          case when p_replace then 'import_replace' else 'import' end,
          jsonb_build_object('rows', n));

  return n;
end;
$$;

revoke execute on function public.import_boq(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_boq(uuid, jsonb, boolean) to authenticated;

-- Hapus seluruh BOQ (hanya kalau belum dipakai laporan).
create function public.clear_boq(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_id uuid;
begin
  if not private.is_project_admin(p_project_id) then
    raise exception 'Hanya Admin yang bisa menghapus BOQ' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.report_volumes rv
    join public.boq_items b on b.id = rv.boq_item_id
    where b.project_id = p_project_id
  ) then
    raise exception 'BOQ sudah dipakai laporan dan tidak bisa dihapus' using errcode = '23503';
  end if;

  perform set_config('sitereport.bulk_boq', 'on', true);
  delete from public.boq_items where project_id = p_project_id;
  perform set_config('sitereport.bulk_boq', 'off', true);

  select workspace_id into ws_id from public.projects where id = p_project_id;
  insert into public.audit_log (workspace_id, project_id, actor_id, entity, action)
  values (ws_id, p_project_id, (select auth.uid()), 'boq_items', 'clear');
end;
$$;

revoke execute on function public.clear_boq(uuid) from public, anon;
grant execute on function public.clear_boq(uuid) to authenticated;

-- Audit perubahan BOQ satuan (edit manual). Import massal dicatat sebagai satu baris di atas.
create function private.audit_boq_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid    uuid;
  ws_id  uuid;
  row_id uuid;
begin
  if coalesce(current_setting('sitereport.bulk_boq', true), '') = 'on' then
    return null;
  end if;

  -- Kolom tiap tabel berbeda, jadi akses NEW/OLD dipisah per cabang IF.
  if tg_table_name = 'boq_item_prices' then
    row_id := coalesce(new.boq_item_id, old.boq_item_id);
    select project_id into pid from public.boq_items where id = row_id;
  else
    row_id := coalesce(new.id, old.id);
    pid := coalesce(new.project_id, old.project_id);
  end if;

  select workspace_id into ws_id from public.projects where id = pid;
  if ws_id is null then
    return null;
  end if;

  insert into public.audit_log (workspace_id, project_id, actor_id, entity, entity_id, action, before, after)
  values (
    ws_id, pid, (select auth.uid()), tg_table_name,
    row_id,
    lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end;
$$;

-- weight_pct sengaja tidak dipantau: kolom itu dihitung ulang otomatis setiap harga berubah.
create trigger boq_items_audit
  after insert or delete
  or update of parent_id, level, code, name, spec, unit, contract_volume, weight_source
  on public.boq_items
  for each row execute function private.audit_boq_change();

create trigger boq_item_prices_audit
  after insert or update or delete on public.boq_item_prices
  for each row execute function private.audit_boq_change();

-- ---------------------------------------------------------------------------
-- Tambah item manual: disisipkan setelah anak terakhir induknya (urutan BOQ tetap rapi).
-- ---------------------------------------------------------------------------
create function public.add_boq_item(
  p_project_id uuid,
  p_parent_id uuid,
  p_name text,
  p_code text default null,
  p_spec text default null,
  p_unit text default null,
  p_volume numeric default null,
  p_unit_price numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_level smallint := 0;
  insert_at    int;
  new_id       uuid;
begin
  if not private.is_project_admin(p_project_id) then
    raise exception 'Hanya Admin yang bisa mengubah BOQ' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Nama item wajib diisi' using errcode = '22023';
  end if;

  if p_parent_id is not null then
    select level into parent_level from public.boq_items
    where id = p_parent_id and project_id = p_project_id;
    if parent_level is null then
      raise exception 'Induk tidak ditemukan' using errcode = 'P0002';
    end if;
    if parent_level >= 6 then
      raise exception 'BOQ maksimal 6 level' using errcode = '22023';
    end if;
    if exists (select 1 from public.report_volumes where boq_item_id = p_parent_id) then
      raise exception 'Item ini sudah punya volume di laporan, tidak bisa diberi sub-item'
        using errcode = '23503';
    end if;

    -- Posisi setelah keturunan terakhir induk.
    with recursive sub as (
      select id, sort_order from public.boq_items where id = p_parent_id
      union all
      select b.id, b.sort_order from public.boq_items b join sub on b.parent_id = sub.id
    )
    select max(sort_order) + 1 into insert_at from sub;
  else
    select coalesce(max(sort_order), -1) + 1 into insert_at
    from public.boq_items where project_id = p_project_id;
  end if;

  update public.boq_items
  set sort_order = sort_order + 1
  where project_id = p_project_id and sort_order >= insert_at;

  insert into public.boq_items
    (project_id, parent_id, level, code, name, spec, unit, contract_volume, sort_order)
  values (
    p_project_id, p_parent_id, parent_level + 1,
    nullif(trim(p_code), ''), left(trim(p_name), 500), nullif(trim(p_spec), ''),
    nullif(trim(p_unit), ''), p_volume, insert_at
  )
  returning id into new_id;

  -- Induk yang tadinya daun sekarang grup: lepas volume & harganya.
  if p_parent_id is not null then
    update public.boq_items set unit = null, contract_volume = null where id = p_parent_id;
    delete from public.boq_item_prices where boq_item_id = p_parent_id;
  end if;

  if p_unit_price is not null then
    insert into public.boq_item_prices (boq_item_id, unit_price) values (new_id, p_unit_price);
  end if;

  return new_id;
end;
$$;

revoke execute on function public.add_boq_item(uuid, uuid, text, text, text, text, numeric, numeric)
  from public, anon;
grant execute on function public.add_boq_item(uuid, uuid, text, text, text, text, numeric, numeric)
  to authenticated;
