-- SiteReport: menutup jalur tulis langsung yang melewati pengecekan RPC laporan.

-- 1. Periode laporan hanya ditentukan start_report (batas tanggal, batas terlambat,
--    perataan periode). Klien tidak boleh mengubahnya langsung.
revoke update (period_start, period_end) on public.reports from authenticated;

-- 2. Volume hanya untuk item BOQ terbawah, apa pun jalurnya (RPC atau tulis langsung).
create function private.assert_leaf_volume()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.boq_items where parent_id = new.boq_item_id) then
    raise exception 'Volume hanya bisa diisi untuk item BOQ terbawah' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger report_volumes_leaf_only
  before insert or update of boq_item_id on public.report_volumes
  for each row execute function private.assert_leaf_volume();

-- 3. Baris foto harus menunjuk file di folder laporannya sendiri:
--    {workspace_id}/{project_id}/{report_id}/{nama file}
create function private.assert_photo_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected text;
begin
  select pr.workspace_id || '/' || pr.id || '/' || r.id || '/'
  into expected
  from public.reports r
  join public.projects pr on pr.id = r.project_id
  where r.id = new.report_id;

  if expected is null
     or left(new.storage_path, length(expected)) <> expected
     or position('/' in substr(new.storage_path, length(expected) + 1)) > 0
     or length(new.storage_path) = length(expected) then
    raise exception 'Path foto tidak sesuai dengan laporannya' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger report_photos_path_check
  before insert or update of storage_path, report_id on public.report_photos
  for each row execute function private.assert_photo_path();

grant execute on all functions in schema private to authenticated;
