// Barrera de la BD del cliente: lo que la IA puede leer y la estructura que puede agregar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReadQuery, checkSchemaChange } from "./guard";

const allowedReads = [
  "select id, email from users where id = 1",
  "SELECT count(*) FROM orders",
  "with t as (select 1 as x) select x from t",
  "select * from \"Orders\" where note = 'drop table users; delete from x'",
  "select pg_typeof(price) from products",
  "select 1 -- update users set x = 1",
];

const blockedReads: [string, string][] = [
  ["delete from users", "escritura"],
  ["select 1; delete from users", "dos sentencias"],
  ["update users set admin = true", "escritura"],
  ["select * into backup from users", "select into"],
  ["select pg_sleep(100)", "función peligrosa"],
  ['select "pg_sleep"(100)', "función entre comillas"],
  ['select "pg_terminate_backend"(pid) from x', "función entre comillas"],
  ['select "pg_catalog"."pg_sleep"(1)', "esquema y función entre comillas"],
  ["select * from auth.users", "esquema del sistema"],
  ['select * from "auth".users', "esquema entre comillas"],
  ['select * from "auth"."users"', "esquema y tabla entre comillas"],
  ["select * from pg_stat_activity", "catálogo sin esquema"],
  ["select rolpassword from pg_authid", "catálogo sin esquema"],
  ['select * from U&"\\0061uth".users', "identificador unicode"],
  ["select $$x$$", "dólar"],
  ["select 'abc", "comillas sin cerrar"],
  ["select current_setting('x')", "configuración"],
  ["select set_config('default_transaction_read_only','off',false)", "set_config"],
  ["select nextval('s')", "secuencia"],
  ["select * from dblink('host=x', 'select 1') as t(a int)", "dblink"],
];

const allowedDdl = [
  "create table if not exists notes (id bigint primary key, body text not null)",
  "alter table orders add column paid_at timestamptz",
  "create index if not exists orders_user_idx on orders (user_id)",
  "alter table orders alter column status set default 'new'",
  "comment on column orders.status is 'estado del pedido'",
  "alter table orders add column created_at timestamptz not null default now()",
  "alter table orders add column ref uuid default extensions.uuid_generate_v4()",
  "alter table orders add column code varchar(12) default 'x'::varchar(12)",
  "create table t (id uuid primary key default gen_random_uuid(), qty numeric(10,2) check (qty >= 0 and qty < 1000), status text check (status in ('a','b')), user_id uuid references users(id))",
  "alter table orders add constraint qty_positive check (coalesce(qty, 0) >= 0)",
];

const blockedDdl: [string, string][] = [
  ["drop table users", "destruye"],
  ["alter table users drop column email", "destruye"],
  ["alter table users rename to people", "renombra"],
  ["truncate users", "borra datos"],
  ["create table x (id int references users on delete cascade)", "cascade"],
  ['create table "auth".x (id int)', "esquema del sistema entre comillas"],
  ["create table auth.x (id int)", "esquema del sistema"],
  ["alter table orders alter column status set default pg_sleep(10)", "default peligroso"],
  ['alter table orders alter column status set default "pg_terminate_backend"(1)', "default entre comillas"],
  ["alter table orders alter column total type numeric using total::numeric", "cambia tipo"],
  ["create table copy as select * from users", "copia datos"],
  ["create function f() returns int as 'select 1' language sql", "función"],
  ["", "vacío"],
  ["alter table t add column x int default public.purge_old()", "función del cliente en DEFAULT"],
  ["alter table t add column x int default purge_old()", "función sin esquema en DEFAULT"],
  ['alter table t add column x int default "purge_old"()', "función entre comillas en DEFAULT"],
  ["alter table t add constraint c check (audit_log(id))", "función del cliente en CHECK"],
  ["create table t (id int default nuke(), name text)", "función en DEFAULT de CREATE TABLE"],
  ["alter table t alter column x set default random_side_effect()", "función en SET DEFAULT"],
  ["create table t (id int references users(id) on delete set null)", "ON DELETE cambia filas hijas"],
];

test("lecturas permitidas", () => {
  for (const sql of allowedReads) assert.equal(checkReadQuery(sql).ok, true, sql);
});

test("lecturas bloqueadas", () => {
  for (const [sql, why] of blockedReads) assert.equal(checkReadQuery(sql).ok, false, `${why}: ${sql}`);
});

test("estructura permitida", () => {
  for (const sql of allowedDdl) assert.equal(checkSchemaChange(sql).ok, true, sql);
});

test("estructura bloqueada", () => {
  for (const [sql, why] of blockedDdl) assert.equal(checkSchemaChange(sql).ok, false, `${why}: ${sql}`);
});

test("máximo de sentencias", () => {
  const many = Array.from({ length: 11 }, (_, i) => `alter table t add column c${i} int`).join(";\n");
  assert.equal(checkSchemaChange(many).ok, false);
});
