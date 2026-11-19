// Cek cepat migrasi + RLS tanpa Docker, memakai PGlite (Postgres di dalam Node).
// Schema auth & storage milik Supabase diganti stub minimal, jadi ini BUKAN pengganti
// `npm run db:test` di Supabase asli. Jalankan: npm run db:check
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migDir = join(import.meta.dirname, "..", "supabase", "migrations");
const db = new PGlite();

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create schema storage;
create table storage.buckets (id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
grant usage on schema storage to authenticated;
grant all on storage.objects to authenticated;
grant execute on function storage.foldername(text) to authenticated;
grant usage on schema public to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

for (const f of readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
  try {
    await db.exec(readFileSync(join(migDir, f), "utf8"));
    console.log("OK  ", f);
  } catch (e) {
    console.log("FAIL", f, e.message);
    process.exit(1);
  }
}

const U = {
  admin: "11111111-1111-1111-1111-111111111111",
  pengawas: "22222222-2222-2222-2222-222222222222",
  pelaksana: "33333333-3333-3333-3333-333333333333",
  pelaksana2: "55555555-5555-5555-5555-555555555555",
  outsider: "44444444-4444-4444-4444-444444444444",
  invitee: "66666666-6666-6666-6666-666666666666",
};
for (const [k, id] of Object.entries(U)) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    `${k}@x.test`,
    { full_name: k },
  ]);
}

let failures = 0;
async function as(user, sql, params = []) {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ""]);
  await db.exec("set role authenticated");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function ok(name, fn, check) {
  try {
    const r = await fn();
    if (check && !check(r)) {
      failures++;
      console.log("FAIL", name, JSON.stringify(r.rows));
    } else console.log("pass", name);
    return r;
  } catch (e) {
    failures++;
    console.log("FAIL", name, e.message);
    return { rows: [{}] };
  }
}
async function err(name, fn) {
  try {
    await fn();
    failures++;
    console.log("FAIL (no error)", name);
  } catch (e) {
    console.log("pass", name, "->", e.message.slice(0, 70));
  }
}

// ---- Tenancy, BOQ, laporan ----
const ws = (await ok("admin creates workspace", () =>
  as(U.admin, `insert into public.workspaces (name, slug, created_by) values ('PT A','pt-a',$1) returning id`, [U.admin]),
  (r) => r.rows.length === 1)).rows[0].id;

const proj = (await ok("admin creates project", () =>
  as(U.admin, `insert into public.projects (workspace_id, name) values ($1,'Gedung X') returning id`, [ws]),
  (r) => r.rows.length === 1)).rows[0].id;

await ok("admin adds members", () => as(U.admin,
  `insert into public.project_members (project_id, user_id, role) values ($1,$2,'pengawas'),($1,$3,'pelaksana'),($1,$4,'pelaksana')`,
  [proj, U.pengawas, U.pelaksana, U.pelaksana2]));

const div = (await as(U.admin, `insert into public.boq_items (project_id, level, name) values ($1,1,'Struktur') returning id`, [proj])).rows[0].id;
const item = (await as(U.admin,
  `insert into public.boq_items (project_id, parent_id, level, name, unit, contract_volume) values ($1,$2,2,'Pengecoran','m3',100) returning id`,
  [proj, div])).rows[0].id;
await err("BOQ level jump rejected", () => as(U.admin,
  `insert into public.boq_items (project_id, parent_id, level, name) values ($1,$2,3,'x')`, [proj, div]));
await ok("admin sets price", () => as(U.admin, `insert into public.boq_item_prices values ($1, 1500000)`, [item]));

await ok("pengawas cannot see prices", () => as(U.pengawas, `select * from public.boq_item_prices`), (r) => r.rows.length === 0);
await ok("pelaksana cannot see prices", () => as(U.pelaksana, `select * from public.boq_item_prices`), (r) => r.rows.length === 0);
await ok("pelaksana sees BOQ", () => as(U.pelaksana, `select * from public.boq_items`), (r) => r.rows.length === 2);
await ok("outsider sees nothing", () => as(U.outsider, `select * from public.projects`), (r) => r.rows.length === 0);
await ok("outsider sees no workspace", () => as(U.outsider, `select * from public.workspaces`), (r) => r.rows.length === 0);
await ok("pengawas sees workspace name", () => as(U.pengawas, `select name from public.workspaces`), (r) => r.rows.length === 1);
await err("pengawas cannot create project", () => as(U.pengawas,
  `insert into public.projects (workspace_id, name) values ($1,'Y')`, [ws]));

const labor = (await ok("pelaksana adds master item", () => as(U.pelaksana,
  `insert into public.master_items (project_id, kind, name) values ($1,'labor','Tukang') returning id`, [proj]))).rows[0].id;

const TODAY = `(now() at time zone 'Asia/Jakarta')::date`;
await err("pengawas cannot start report", () => as(U.pengawas,
  `select public.start_report($1, ${TODAY})`, [proj]));
await err("direct insert into reports blocked", () => as(U.pelaksana,
  `insert into public.reports (project_id, author_id, period_start, period_end) values ($1,$2,'2026-11-18','2026-11-18')`, [proj, U.pelaksana]));
await err("future date rejected", () => as(U.pelaksana,
  `select public.start_report($1, ${TODAY} + 1)`, [proj]));
await err("beyond backdate limit rejected", () => as(U.pelaksana,
  `select public.start_report($1, ${TODAY} - 3)`, [proj]));
const rep = (await ok("pelaksana starts draft", () => as(U.pelaksana,
  `select public.start_report($1, ${TODAY}) as id`, [proj]))).rows[0].id;
await ok("start_report is idempotent", () => as(U.pelaksana,
  `select public.start_report($1, ${TODAY}) as id`, [proj]), (r) => r.rows[0].id === rep);
await ok("backdate within limit allowed", () => as(U.pelaksana,
  `select public.start_report($1, ${TODAY} - 2) as id`, [proj]), (r) => !!r.rows[0].id);
await ok("admin unlocks old date", async () => {
  await as(U.admin, `select public.unlock_backdate($1, $2, ${TODAY} - 10)`, [proj, U.pelaksana]);
  return as(U.pelaksana, `select public.start_report($1, ${TODAY} - 10) as id`, [proj]);
}, (r) => !!r.rows[0].id);
// Bersihkan draft tambahan supaya tes di bawah hanya melihat satu laporan.
await db.query(`delete from public.reports where id <> $1`, [rep]);

await ok("pelaksana adds labor", () => as(U.pelaksana,
  `insert into public.report_labor (report_id, master_item_id, count) values ($1,$2,5)`, [rep, labor]));
await err("labor row with equipment kind rejected", () => as(U.pelaksana,
  `insert into public.report_equipment (report_id, master_item_id, count) values ($1,$2,1)`, [rep, labor]));
await ok("pelaksana adds volume", () => as(U.pelaksana,
  `insert into public.report_volumes (report_id, boq_item_id, volume) values ($1,$2,12.5)`, [rep, item]));
await err("pelaksana cannot set dup_resolution", () => as(U.pelaksana,
  `update public.report_volumes set dup_resolution='valid' where report_id=$1`, [rep]));
await err("pelaksana cannot change status", () => as(U.pelaksana,
  `update public.reports set status='approved' where id=$1`, [rep]));

await ok("pengawas cannot see draft", () => as(U.pengawas, `select * from public.reports`), (r) => r.rows.length === 0);
await ok("pelaksana2 cannot see other draft", () => as(U.pelaksana2, `select * from public.reports`), (r) => r.rows.length === 0);
await ok("admin sees draft", () => as(U.admin, `select * from public.reports`), (r) => r.rows.length === 1);

await db.query(`update public.reports set status='submitted' where id=$1`, [rep]);
await ok("pengawas sees submitted", () => as(U.pengawas, `select * from public.reports`), (r) => r.rows.length === 1);
await ok("pengawas sees labor", () => as(U.pengawas, `select * from public.report_labor`), (r) => r.rows.length === 1);
await ok("pelaksana cannot edit submitted (0 rows)", () => as(U.pelaksana,
  `update public.reports set notes_raw='x' where id=$1 returning id`, [rep]), (r) => r.rows.length === 0);

await ok("storage insert allowed for editable report path", async () => {
  await db.query(`update public.reports set status='draft' where id=$1`, [rep]);
  return as(U.pelaksana, `insert into storage.objects (bucket_id, name) values ('report-photos', $1) returning id`,
    [`${ws}/${proj}/${rep}/p1.webp`]);
}, (r) => r.rows.length === 1);
await err("storage insert rejected for outsider", () => as(U.outsider,
  `insert into storage.objects (bucket_id, name) values ('report-photos', $1)`, [`${ws}/${proj}/${rep}/p2.webp`]));
await err("storage insert rejected for bad path", () => as(U.pelaksana,
  `insert into storage.objects (bucket_id, name) values ('report-photos', 'junk/p.webp')`));

await ok("profiles auto-created", () => db.query(`select count(*)::int c from public.profiles`), (r) => r.rows[0].c === 6);
await ok("outsider sees only own profile", () => as(U.outsider, `select id from public.profiles`), (r) => r.rows.length === 1);
await ok("pengawas sees team profiles", () => as(U.pengawas, `select id from public.profiles`), (r) => r.rows.length === 4);

// ---- Undangan & kode proyek ----
const INV = U.invitee;
await ok("profile has email", () => db.query(`select email from public.profiles where id=$1`, [INV]),
  (r) => r.rows[0]?.email === "invitee@x.test");

await err("pengawas cannot create invite", () => as(U.pengawas,
  `select public.create_project_invite($1, 'pelaksana')`, [proj]));
await err("viewer invite rejected", () => as(U.admin,
  `select public.create_project_invite($1, 'viewer')`, [proj]));
const token = (await ok("admin creates invite", () => as(U.admin,
  `select public.create_project_invite($1, 'pengawas', 1) as t`, [proj]),
  (r) => /^[0-9a-f]{64}$/.test(r.rows[0].t))).rows[0].t;

await ok("invite stores hash only", () => db.query(`select token_hash from public.project_invites`),
  (r) => r.rows.length === 1 && r.rows[0].token_hash !== token);
await ok("preview invite", () => as(INV, `select * from public.preview_project_invite($1)`, [token]),
  (r) => r.rows[0]?.project_name === "Gedung X" && r.rows[0].is_valid === true && r.rows[0].already_member === false);
await ok("preview bad token empty", () => as(INV, `select * from public.preview_project_invite('nope')`),
  (r) => r.rows.length === 0);
await ok("invitee accepts", () => as(INV, `select public.accept_project_invite($1) as p`, [token]),
  (r) => r.rows[0].p === proj);
await ok("invitee is active pengawas", () => as(INV, `select role, status from public.project_members where user_id=$1`, [INV]),
  (r) => r.rows[0]?.role === "pengawas" && r.rows[0]?.status === "active");
await ok("invitee sees project", () => as(INV, `select id from public.projects`), (r) => r.rows.length === 1);
await err("max_uses enforced", () => as(U.outsider, `select public.accept_project_invite($1)`, [token]));

const token2 = (await as(U.admin, `select public.create_project_invite($1, 'pelaksana') as t`, [proj])).rows[0].t;
const invId = (await db.query(`select id from public.project_invites where used_count = 0`)).rows[0].id;
await ok("admin revokes invite", () => as(U.admin, `select public.revoke_project_invite($1)`, [invId]));
await err("revoked invite rejected", () => as(U.outsider, `select public.accept_project_invite($1)`, [token2]));

const code = (await db.query(`select join_code from public.projects where id=$1`, [proj])).rows[0].join_code;
await err("bad code rejected", () => as(U.outsider, `select * from public.request_join_by_code('ZZZZZZZZ')`));
await ok("outsider requests join (lowercase code ok)", () => as(U.outsider,
  `select * from public.request_join_by_code($1)`, [` ${code.toLowerCase()} `]),
  (r) => r.rows[0]?.status === "pending" && r.rows[0]?.project_name === "Gedung X");
await ok("pending user cannot see project", () => as(U.outsider, `select id from public.projects`), (r) => r.rows.length === 0);
await ok("pending user sees own request", () => as(U.outsider, `select * from public.my_pending_join_requests()`),
  (r) => r.rows.length === 1);
await ok("admin notified", () => db.query(`select * from public.notifications where user_id=$1 and type='join_request'`, [U.admin]),
  (r) => r.rows.length === 1);
await err("pengawas cannot approve", () => as(U.pengawas,
  `select public.approve_join_request($1,$2,'pelaksana')`, [proj, U.outsider]));
await ok("admin approves as pelaksana", () => as(U.admin,
  `select public.approve_join_request($1,$2,'pelaksana')`, [proj, U.outsider]));
await ok("approved user sees project", () => as(U.outsider, `select id from public.projects`), (r) => r.rows.length === 1);
await ok("approved user notified", () => db.query(`select * from public.notifications where user_id=$1 and type='join_approved'`, [U.outsider]),
  (r) => r.rows.length === 1);
await ok("repeat request keeps active", () => as(U.outsider, `select * from public.request_join_by_code($1)`, [code]),
  (r) => r.rows[0]?.status === "active");
await ok("audit rows written", () => db.query(`select entity, action from public.audit_log where entity in ('project_members','project_invites')`),
  (r) => r.rows.length >= 6);
await ok("audit has no token hash", () => db.query(`select 1 from public.audit_log where after ? 'token_hash' or before ? 'token_hash'`),
  (r) => r.rows.length === 0);
await ok("admin regenerates code", () => as(U.admin, `select public.regenerate_join_code($1) as c`, [proj]),
  (r) => /^[0-9A-F]{8}$/.test(r.rows[0].c) && r.rows[0].c !== code);
await err("anon cannot call rpc", async () => {
  await db.exec("set role anon");
  try {
    return await db.query(`select * from public.my_pending_join_requests()`);
  } finally {
    await db.exec("reset role");
  }
});

// ---- BOQ: import, bobot, spesifikasi ----
await ok("price change recalculates weight (single leaf = 100%)", () =>
  as(U.admin, `select weight_pct from public.boq_items where id=$1`, [item]),
  (r) => Number(r.rows[0]?.weight_pct) === 100);
await ok("group has no weight", () => as(U.admin, `select weight_pct from public.boq_items where id=$1`, [div]),
  (r) => r.rows[0]?.weight_pct === null);
await err("import refused when BOQ used by reports", () => as(U.admin,
  `select public.import_boq($1, '[{"key":"a","level":1,"name":"X"}]'::jsonb, true)`, [proj]));
await err("import refused without replace", () => as(U.admin,
  `select public.import_boq($1, '[{"key":"a","level":1,"name":"X"}]'::jsonb, false)`, [proj]));

const proj2 = (await as(U.admin, `insert into public.projects (workspace_id, name) values ($1,'Gedung Y') returning id`, [ws])).rows[0].id;
await as(U.admin, `insert into public.project_members (project_id, user_id, role) values ($1,$2,'pelaksana')`, [proj2, U.pelaksana]);
const items = [
  { key: "s", level: 1, name: "PEKERJAAN STRUKTUR" },
  { key: "s1", parent_key: "s", level: 2, code: "I.", name: "Persiapan" },
  { key: "s1a", parent_key: "s1", level: 3, code: "a.", name: "Tanah" },
  { key: "s1a1", parent_key: "s1a", level: 4, code: "1", name: "galian", unit: "m3", volume: 100, unit_price: 30000 },
  { key: "s1a2", parent_key: "s1a", level: 4, code: "2", name: "rabat beton", spec: "mutu f'c = 7,4 Mpa", unit: "m3", volume: 10, unit_price: 100000 },
  { key: "a", level: 1, name: "PEKERJAAN ARSITEKTUR" },
  { key: "a1", parent_key: "a", level: 2, code: "1", name: "fitting", unit: "lot", volume: 1, unit_price: 0 },
  { key: "a2", parent_key: "a", level: 2, code: "2", name: "tanpa harga", unit: "unit", volume: 2 },
];
await err("pelaksana cannot import", () => as(U.pelaksana,
  `select public.import_boq($1, $2::jsonb)`, [proj2, JSON.stringify(items)]));
await err("bad parent order rejected", () => as(U.admin,
  `select public.import_boq($1, $2::jsonb)`, [proj2, JSON.stringify([items[1]])]));
await ok("admin imports BOQ", () => as(U.admin,
  `select public.import_boq($1, $2::jsonb) as n`, [proj2, JSON.stringify(items)]),
  (r) => r.rows[0].n === 8);
await ok("weights from price x volume", () => as(U.admin,
  `select name, weight_pct::float as w from public.boq_items where project_id=$1 and weight_pct is not null order by sort_order`, [proj2]),
  (r) => {
    const w = Object.fromEntries(r.rows.map((x) => [x.name, x.w]));
    return w.galian === 75 && w["rabat beton"] === 25 && w.fitting === 0 && w["tanpa harga"] === 0;
  });
await ok("spec stored", () => as(U.pelaksana, `select spec from public.boq_items where name='rabat beton'`),
  (r) => r.rows[0]?.spec === "mutu f'c = 7,4 Mpa");
await ok("pelaksana still cannot see imported prices", () => as(U.pelaksana,
  `select * from public.boq_item_prices p join public.boq_items b on b.id = p.boq_item_id where b.project_id=$1`, [proj2]),
  (r) => r.rows.length === 0);
await ok("import audited as one row", () => db.query(
  `select count(*)::int c from public.audit_log where project_id=$1 and entity='boq_items'`, [proj2]),
  (r) => r.rows[0].c === 1);
await ok("manual price edit recalculates", async () => {
  await as(U.admin, `update public.boq_item_prices set unit_price = 90000
    where boq_item_id = (select id from public.boq_items where name='rabat beton' and project_id=$1)`, [proj2]);
  return as(U.admin, `select weight_pct::float w from public.boq_items where name='galian' and project_id=$1`, [proj2]);
}, (r) => Math.abs(r.rows[0].w - 76.923077) < 0.0001);
await ok("level 6 allowed", async () => {
  let parent = null;
  for (let lvl = 1; lvl <= 6; lvl++) {
    const r = await as(U.admin, `insert into public.boq_items (project_id, parent_id, level, name) values ($1,$2,$3,'L') returning id`, [proj2, parent, lvl]);
    parent = r.rows[0].id;
  }
  return { rows: [{ parent }] };
}, (r) => !!r.rows[0].parent);
await ok("add item under leaf turns it into group", async () => {
  const leaf = (await as(U.admin, `select id from public.boq_items where project_id=$1 and name='galian'`, [proj2])).rows[0].id;
  await as(U.admin, `select public.add_boq_item($1, $2, 'sub galian', '1.a', null, 'm3', 5, 1000)`, [proj2, leaf]);
  return as(U.admin, `select b.name, b.level, b.unit, b.sort_order, (select count(*)::int from public.boq_item_prices p where p.boq_item_id=b.id) price
    from public.boq_items b where project_id=$1 and name in ('galian','sub galian','rabat beton') order by sort_order`, [proj2]);
}, (r) => r.rows.map((x) => x.name).join() === "galian,sub galian,rabat beton"
  && r.rows[0].unit === null && r.rows[0].price === 0 && r.rows[1].level === 5);
await err("pelaksana cannot add item", () => as(U.pelaksana,
  `select public.add_boq_item($1, null, 'x')`, [proj2]));
await ok("admin replaces BOQ", () => as(U.admin,
  `select public.import_boq($1, $2::jsonb, true) as n`, [proj2, JSON.stringify(items.slice(0, 4))]),
  (r) => r.rows[0].n === 4);
await ok("admin clears BOQ", async () => {
  await as(U.admin, `select public.clear_boq($1)`, [proj2]);
  return db.query(`select count(*)::int c from public.boq_items where project_id=$1`, [proj2]);
}, (r) => r.rows[0].c === 0);

// ---- Alur laporan: draft, submit, duplikat, review, kunci ----
const weather = [
  { slot: "pagi", condition: "cerah" },
  { slot: "siang", condition: "berawan" },
  { slot: "sore", condition: "hujan", rain_hours: 1.5 },
];
const photo = (reportId, sha) =>
  `insert into public.report_photos (report_id, storage_path, sha256, source, size_bytes)
   values ('${reportId}', '${ws}/${proj}/${reportId}/${sha.slice(0, 8)}.webp', '${sha}', 'camera', 1000)`;

await ok("pelaksana saves draft", () => as(U.pelaksana, `select public.save_report_draft($1, $2::jsonb)`, [rep,
  JSON.stringify({ notes_raw: "cor kolom", weather, labor: [{ master_item_id: labor, count: 5 }], volumes: [{ boq_item_id: item, volume: 12.5 }] })]));
await ok("draft saved children", () => as(U.pelaksana,
  `select (select count(*)::int from public.report_weather where report_id=$1) w,
          (select rain_hours::float from public.report_weather where report_id=$1 and slot='sore') rh,
          (select volume::float from public.report_volumes where report_id=$1) v`, [rep]),
  (r) => r.rows[0].w === 3 && r.rows[0].rh === 1.5 && r.rows[0].v === 12.5);
await err("volume on group item rejected", () => as(U.pelaksana, `select public.save_report_draft($1, $2::jsonb)`, [rep,
  JSON.stringify({ weather, volumes: [{ boq_item_id: div, volume: 1 }] })]));
await err("pengawas cannot save other's draft", () => as(U.pengawas, `select public.save_report_draft($1, '{}'::jsonb)`, [rep]));
await err("submit without photo rejected", () => as(U.pelaksana, `select public.submit_report($1)`, [rep]));
await ok("pelaksana adds photo row", () => as(U.pelaksana, photo(rep, "a".repeat(64))));
await ok("submit ok, no duplicates", () => as(U.pelaksana, `select public.submit_report($1) as r`, [rep]),
  (r) => r.rows[0].r.duplicates === 0);
await ok("pengawas notified of submit", () => db.query(
  `select count(*)::int c from public.notifications where type='report_submitted'`), (r) => r.rows[0].c >= 1);
await err("pelaksana cannot edit submitted", () => as(U.pelaksana, `select public.save_report_draft($1, '{}'::jsonb)`, [rep]));

const rep2 = (await as(U.pelaksana2, `select public.start_report($1, ${TODAY}) as id`, [proj])).rows[0].id;
await as(U.pelaksana2, `select public.save_report_draft($1, $2::jsonb)`, [rep2,
  JSON.stringify({ weather, volumes: [{ boq_item_id: item, volume: 12.6 }] })]);
await as(U.pelaksana2, photo(rep2, "a".repeat(64)));
await ok("second report flags volume (≤1%) and photo duplicates", () =>
  as(U.pelaksana2, `select public.submit_report($1) as r`, [rep2]), (r) => r.rows[0].r.duplicates === 2);
await err("pelaksana cannot approve", () => as(U.pelaksana, `select public.approve_report($1)`, [rep2]));
await err("approve blocked while duplicates unresolved", () => as(U.pengawas, `select public.approve_report($1)`, [rep2]));
await ok("pengawas resolves volume as valid", () => as(U.pengawas,
  `select public.resolve_duplicate($1, 'volume', $2, 'valid')`, [rep2, item]));
const dupPhoto = (await db.query(`select id from public.report_photos where report_id=$1`, [rep2])).rows[0].id;
await ok("pengawas marks photo duplicate", () => as(U.pengawas,
  `select public.resolve_duplicate($1, 'photo', $2, 'duplicate')`, [rep2, dupPhoto]));
await err("approve blocked when something is duplicate", () => as(U.pengawas, `select public.approve_report($1)`, [rep2]));
await err("revision needs a note", () => as(U.pengawas, `select public.request_revision($1, '')`, [rep2]));
await ok("pengawas requests revision with section comment", () => as(U.pengawas,
  `select public.request_revision($1, 'Foto sama dengan laporan lain', $2::jsonb)`,
  [rep2, JSON.stringify([{ section: "foto", comment: "Ganti foto" }])]));
await ok("revision comment stored and visible to author", () => as(U.pelaksana2,
  `select c.section from public.report_review_comments c join public.report_reviews r on r.id = c.review_id where r.report_id=$1`, [rep2]),
  (r) => r.rows[0]?.section === "foto");
await ok("author fixes photo and resubmits", async () => {
  await as(U.pelaksana2, `delete from public.report_photos where report_id=$1`, [rep2]);
  await as(U.pelaksana2, photo(rep2, "b".repeat(64)));
  return as(U.pelaksana2, `select public.submit_report($1) as r`, [rep2]);
}, (r) => r.rows[0].r.duplicates === 1);
await ok("pengawas resolves and approves", async () => {
  await as(U.pengawas, `select public.resolve_duplicate($1, 'volume', $2, 'valid')`, [rep2, item]);
  await as(U.pengawas, `select public.approve_report($1, 'OK')`, [rep2]);
  return db.query(`select status, approved_by from public.reports where id=$1`, [rep2]);
}, (r) => r.rows[0].status === "approved" && r.rows[0].approved_by === U.pengawas);
await err("approved report locked for author", () => as(U.pelaksana2, `select public.save_report_draft($1, '{}'::jsonb)`, [rep2]));
await err("approved report locked even for superuser update", () =>
  db.query(`update public.reports set notes_raw='x' where id=$1`, [rep2]));
await err("approved children locked", () => db.query(`delete from public.report_volumes where report_id=$1`, [rep2]));
await err("pengawas cannot reopen", () => as(U.pengawas, `select public.reopen_report($1, 'salah')`, [rep2]));
await ok("admin reopens with reason", async () => {
  await as(U.admin, `select public.reopen_report($1, 'volume salah ketik')`, [rep2]);
  return db.query(`select status from public.reports where id=$1`, [rep2]);
}, (r) => r.rows[0].status === "revision_requested");
await ok("author notified of approve, revision, reopen", () => db.query(
  `select array_agg(distinct type order by type) t from public.notifications where user_id=$1`, [U.pelaksana2]),
  (r) => ["report_approved", "report_reopened", "revision_requested"].every((t) => r.rows[0].t.includes(t)));
await ok("first report approved by another pengawas", async () => {
  await as(INV, `select public.approve_report($1)`, [rep]);
  return db.query(`select status from public.reports where id=$1`, [rep]);
}, (r) => r.rows[0].status === "approved");

// ---- Integritas hapus ----
await err("admin cannot delete BOQ item that has volumes", () => as(U.admin,
  `delete from public.boq_items where id=$1`, [item]));
await err("admin cannot delete master item in use", () => as(U.admin,
  `delete from public.master_items where id=$1`, [labor]));

await ok("workspace delete cascades with audit rows", () =>
  as(U.admin, `delete from public.workspaces where id=$1 returning id`, [ws]),
  (r) => r.rows.length === 1);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
