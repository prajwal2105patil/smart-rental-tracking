-- Smart Rental Tracking — Supabase (PostgreSQL) schema
--
-- Every table carries two things: typed columns, so the tables are readable in the
-- Supabase editor and queryable by anyone who opens it, and a `payload` JSONB column
-- holding the record exactly as the API produced it.
--
-- The JSONB is not laziness. It is what lets the API read from Postgres and from the
-- JSON seed files interchangeably with zero shape drift: whatever comes back out is
-- byte-identical to what went in, so a demo cannot break because a column was widened
-- or a date came back as a string instead of a date. The typed columns are for humans
-- and for SQL; the payload is for the machine.
--
-- Run this once in the Supabase SQL editor, then load with:  python db/load_supabase.py

-- ---------------------------------------------------------------- fleet
create table if not exists assets (
  equipment_id              text primary key,
  type                      text not null,
  model                     text,
  serial_number             text,
  site_id                   text,
  operator_id               text,
  on_rent                   boolean not null default false,
  check_out_date            date,
  check_in_date             date,
  engine_hours_day          numeric(6,2) not null default 0,
  idle_hours_day            numeric(6,2) not null default 0,
  operating_days            integer not null default 0,
  cumulative_operating_hours numeric(10,2) not null default 0,
  hours_since_service       numeric(10,2) not null default 0,
  day_rate                  integer not null default 0,
  condition_grade           text check (condition_grade in ('A','B','C')),
  payload                   jsonb not null
);
create index if not exists assets_site_idx on assets (site_id);
create index if not exists assets_type_idx on assets (type);

-- ISO 15143-3 / AEMP 2.0 telemetry. The big table: ~15,000 rows.
create table if not exists telemetry (
  id                        bigserial primary key,
  equipment_id              text not null references assets(equipment_id) on delete cascade,
  reading_at                timestamptz not null,
  latitude                  double precision,
  longitude                 double precision,
  cumulative_operating_hours numeric(10,2),
  cumulative_idle_hours     numeric(10,2),
  fuel_remaining_percent    numeric(5,2),
  fuel_used_litres          numeric(10,2),
  engine_coolant_temp_c     numeric(6,2),
  fault_codes               jsonb not null default '[]'::jsonb,
  payload                   jsonb not null
);
create index if not exists telemetry_asset_time_idx on telemetry (equipment_id, reading_at);

-- APPEND ONLY. Status is a projection over this table and is never stored.
create table if not exists events (
  event_id                  text primary key,
  occurred_at               timestamptz not null,
  equipment_id              text not null,
  event_type                text not null,
  actor                     text not null,
  site_id                   text,
  operator_id               text,
  condition_grade           text,
  notes                     text,
  payload                   jsonb not null
);
create index if not exists events_asset_time_idx on events (equipment_id, occurred_at);

create table if not exists bookings (
  booking_id                text primary key,
  customer                  text not null,
  equipment_type            text not null,
  site_id                   text not null,
  needed_from               date not null,
  days                      integer not null,
  status                    text not null default 'REQUESTED',
  payload                   jsonb not null
);

-- ------------------------------------------- derived from hmd_python.csv (806,485 rows)
create table if not exists catalogue_skus (
  product_key               text primary key,
  description               text,
  category                  text,
  brand                     text,
  duty_type                 text,
  cost                      numeric(12,2),
  price                     numeric(12,2),
  payload                   jsonb not null
);
create index if not exists skus_brand_idx on catalogue_skus (brand);

create table if not exists catalogue_branches (
  store_id                  text primary key,
  city                      text,
  country                   text,
  payload                   jsonb not null
);

create table if not exists catalogue_customers (
  id                        bigserial primary key,
  customer_name             text,
  industry                  text,
  payload                   jsonb not null
);

-- Provenance of the CSV every catalogue row above was derived from. One row.
create table if not exists source_manifest (
  filename                  text primary key,
  sha256                    text not null,
  size_bytes                bigint not null,
  rows                      bigint not null,
  distinct_product_keys     integer,
  distinct_stores           integer,
  distinct_brands           integer,
  caterpillar_row_share_pct numeric(5,2),
  transaction_date_min      date,
  transaction_date_max      date,
  payload                   jsonb not null
);

-- ---------------------------------------------------------------- people
-- Who uses the console, and as what. The role decides which screen they land on;
-- OPS_LEAD additionally requires the dealer access key, which the SERVER checks -
-- there is no password column here and there never should be.
create table if not exists app_users (
  id                        bigserial primary key,
  name                      text not null,
  role                      text not null check (role in ('VIEWER','YARD','OPS_LEAD')),
  site_id                   text,
  organisation              text,
  created_at                timestamptz not null default now(),
  last_seen_at              timestamptz,
  unique (name, role)
);
create index if not exists users_role_idx on app_users (role);

-- A hirer asking to keep a machine longer, or to have it collected.
create table if not exists hire_requests (
  request_id                text primary key,
  raised_at                 timestamptz not null,
  status                    text not null default 'OPEN',
  equipment_id              text not null,
  kind                      text not null check (kind in ('EXTEND','COLLECT')),
  actor                     text not null,
  site_id                   text,
  days                      integer,
  note                      text,
  payload                   jsonb not null
);
create index if not exists requests_site_idx on hire_requests (site_id, status);

-- ---------------------------------------------------------------- convenience views
-- What a human opening Supabase would want to see first.
create or replace view v_fleet_now as
select a.equipment_id, a.type, a.site_id, a.operator_id, a.condition_grade,
       a.engine_hours_day, a.idle_hours_day, a.day_rate, a.check_in_date,
       case
         when a.site_id is null and a.on_rent then 'UNASSIGNED'
         when not a.on_rent                    then 'AT_YARD'
         when a.check_in_date < current_date   then 'OVERDUE'
         when a.engine_hours_day > 0           then 'ACTIVE'
         else 'IDLE'
       end as status_projection,
       round(case when (a.engine_hours_day + a.idle_hours_day) > 0
                  then 100 * a.engine_hours_day / (a.engine_hours_day + a.idle_hours_day)
                  else 0 end, 1) as utilisation_pct
from assets a;

create or replace view v_site_utilisation as
select coalesce(site_id, 'UNASSIGNED') as site_id,
       count(*)                        as machines,
       round(sum(engine_hours_day), 1) as engine_hours,
       round(sum(idle_hours_day), 1)   as idle_hours,
       round(100 * sum(engine_hours_day)
             / nullif(sum(engine_hours_day + idle_hours_day), 0), 1) as utilisation_pct
from assets group by 1 order by utilisation_pct nulls first;
