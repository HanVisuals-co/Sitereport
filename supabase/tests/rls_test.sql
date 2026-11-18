-- Test RLS inti. Jalankan: npx supabase test db (butuh Docker + supabase start).
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- Helper: jalankan sebagai user tertentu.
create or replace function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'admin@x.test',      '{"full_name":"Admin"}'),
  ('22222222-2222-2222-2222-222222222222', 'pengawas@x.test',   '{"full_name":"Pengawas"}'),
  ('33333333-3333-3333-3333-333333333333', 'pelaksana@x.test',  '{"full_name":"Pelaksana"}'),
  ('55555555-5555-5555-5555-555555555555', 'pelaksana2@x.test', '{"full_name":"Pelaksana 2"}'),
  ('44444444-4444-4444-4444-444444444444', 'outsider@x.test',   '{"full_name":"Orang Luar"}');

select is((select count(*)::int from public.profiles), 5, 'profil dibuat otomatis');

-- Data dasar dibuat sebagai Admin.
select pg_temp.login('11111111-1111-1111-1111-111111111111');
insert into public.workspaces (id, name, slug, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'PT A', 'pt-a', '11111111-1111-1111-1111-111111111111');
insert into public.projects (id, workspace_id, name)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Gedung X');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'pengawas'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'pelaksana'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'pelaksana');
insert into public.boq_items (id, project_id, level, name)
  values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 1, 'Struktur');
insert into public.boq_items (id, project_id, parent_id, level, name, unit, contract_volume)
  values ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
          'cccccccc-0000-0000-0000-000000000001', 2, 'Pengecoran', 'm3', 100);
insert into public.boq_item_prices values ('cccccccc-0000-0000-0000-000000000002', 1500000);
select pg_temp.logout();

-- Isolasi tenant.
select pg_temp.login('44444444-4444-4444-4444-444444444444');
select is_empty('select * from public.projects', 'orang luar tidak melihat proyek');
select is_empty('select * from public.workspaces', 'orang luar tidak melihat workspace');
select pg_temp.logout();

-- Harga hanya Admin.
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select is_empty('select * from public.boq_item_prices', 'Pengawas tidak melihat harga');
select throws_ok(
  $$insert into public.projects (workspace_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Y')$$,
  '42501', null, 'Pengawas tidak bisa membuat proyek');
select pg_temp.logout();

select pg_temp.login('33333333-3333-3333-3333-333333333333');
select is_empty('select * from public.boq_item_prices', 'Pelaksana tidak melihat harga');
select is((select count(*)::int from public.boq_items), 2, 'Pelaksana melihat BOQ');

-- Laporan draft.
select lives_ok(
  $$insert into public.reports (id, project_id, author_id, period_start, period_end)
    values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', '2026-11-19', '2026-11-19')$$,
  'Pelaksana membuat draft');
select throws_ok(
  $$update public.reports set status = 'approved' where id = 'dddddddd-0000-0000-0000-000000000001'$$,
  '42501', null, 'Pelaksana tidak bisa mengubah status langsung');
select lives_ok(
  $$insert into public.report_volumes (report_id, boq_item_id, volume)
    values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 12.5)$$,
  'Pelaksana mengisi volume');
select throws_ok(
  $$update public.report_volumes set dup_resolution = 'valid'
    where report_id = 'dddddddd-0000-0000-0000-000000000001'$$,
  '42501', null, 'Pelaksana tidak bisa memutuskan duplikat');
select pg_temp.logout();

select pg_temp.login('22222222-2222-2222-2222-222222222222');
select is_empty('select * from public.reports', 'Pengawas tidak melihat draft');
select pg_temp.logout();

select pg_temp.login('55555555-5555-5555-5555-555555555555');
select is_empty('select * from public.reports', 'Pelaksana lain tidak melihat draft');
select pg_temp.logout();

-- Setelah submit (disimulasikan sebagai superuser; nanti lewat fungsi).
update public.reports set status = 'submitted' where id = 'dddddddd-0000-0000-0000-000000000001';

select pg_temp.login('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.reports), 1, 'Pengawas melihat laporan submitted');
select pg_temp.logout();

select pg_temp.login('33333333-3333-3333-3333-333333333333');
select is_empty(
  $$update public.reports set notes_raw = 'x' where id = 'dddddddd-0000-0000-0000-000000000001' returning id$$,
  'Pelaksana tidak bisa mengedit laporan submitted');
select pg_temp.logout();

insert into public.audit_log (workspace_id, entity, action)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'test', 'insert');
select throws_ok(
  $$update public.audit_log set action = 'x'$$,
  'P0001', 'audit_log bersifat append-only', 'audit_log tidak bisa diubah');

select * from finish();
rollback;
