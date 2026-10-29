-- Clinic booking API schema. Run this whole file in the Supabase SQL editor.
-- Safe to re-run: tables use IF NOT EXISTS, functions use CREATE OR REPLACE.

create table if not exists slots (
  id text primary key,
  provider text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  start_raw text not null,
  end_raw text not null
);
create index if not exists slots_provider_idx on slots (provider);
create index if not exists slots_start_idx on slots (start_at);

create table if not exists bookings (
  seq bigint generated always as identity,
  id text primary key,
  slot_id text not null references slots(id),
  name text not null,
  email text not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);
-- Level 3: the database refuses a second confirmed booking for the same slot.
create unique index if not exists one_confirmed_per_slot on bookings (slot_id) where status = 'confirmed';
create index if not exists bookings_email_seq_idx on bookings (email, seq);

create table if not exists idempotency (
  key text primary key,
  body_hash text not null,
  status int not null,
  response jsonb not null
);

create table if not exists rate_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  at timestamptz not null default clock_timestamp()
);
create index if not exists rate_attempts_email_at_idx on rate_attempts (email, at);

-- No policies on purpose: the public anon key can read nothing.
-- The server uses the service-role key, which bypasses RLS.
alter table slots enable row level security;
alter table bookings enable row level security;
alter table idempotency enable row level security;
alter table rate_attempts enable row level security;

create or replace function booking_json(b bookings) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', b.id,
    'slot_id', b.slot_id,
    'name', b.name,
    'email', b.email,
    'status', b.status,
    'created_at', to_char(b.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

create or replace function reset_data(p_slots jsonb) returns void
language plpgsql as $$
begin
  delete from bookings where true;
  delete from idempotency where true;
  delete from rate_attempts where true;
  delete from slots where true;
  insert into slots (id, provider, start_at, end_at, start_raw, end_raw)
  select e->>'id', e->>'provider', (e->>'start')::timestamptz, (e->>'end')::timestamptz, e->>'start', e->>'end'
  from jsonb_array_elements(p_slots) e;
end $$;

create or replace function list_slots(p_provider text default null) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'provider', s.provider,
    'start', s.start_raw,
    'end', s.end_raw,
    'available', not exists (
      select 1 from bookings b where b.slot_id = s.id and b.status = 'confirmed'
    )
  ) order by s.start_at, s.id), '[]'::jsonb)
  from slots s
  where p_provider is null or s.provider = p_provider;
$$;

create or replace function create_booking(
  p_key text, p_hash text, p_slot_id text, p_name text, p_email text
) returns jsonb language plpgsql as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_idem idempotency%rowtype;
  v_slot slots%rowtype;
  v_row bookings%rowtype;
  v_count int;
  v_oldest timestamptz;
  v_status int;
  v_resp jsonb;
begin
  -- Level 4: requests with the same key are serialized, so concurrent retries
  -- can never both create a booking.
  if p_key is not null then
    perform pg_advisory_xact_lock(hashtext('idem:' || p_key));
    select * into v_idem from idempotency where key = p_key;
    if found then
      if v_idem.body_hash <> p_hash then
        return jsonb_build_object('status', 422,
          'body', jsonb_build_object('error', 'idempotency key reused with a different body'));
      end if;
      return jsonb_build_object('status', v_idem.status, 'body', v_idem.response);
    end if;
  end if;

  -- Level 5: 5 attempts per email per rolling minute, failed attempts included.
  if v_email <> '' then
    perform pg_advisory_xact_lock(hashtext('rate:' || v_email));
    delete from rate_attempts where email = v_email and at < clock_timestamp() - interval '1 minute';
    select count(*), min(at) into v_count, v_oldest from rate_attempts where email = v_email;
    if v_count >= 5 then
      return jsonb_build_object('status', 429,
        'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 minute' - clock_timestamp())))::int),
        'body', jsonb_build_object('error', 'too many attempts, try again later'));
    end if;
    insert into rate_attempts (email) values (v_email);
  end if;

  -- Level 2: validation.
  if btrim(coalesce(p_slot_id, '')) = '' or v_name = '' or v_email = ''
     or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_status := 400;
    v_resp := jsonb_build_object('error', 'slot_id, name and a valid email are required');
  else
    select * into v_slot from slots where id = p_slot_id;
    if not found then
      v_status := 404;
      v_resp := jsonb_build_object('error', 'slot not found');
    elsif v_slot.start_at <= now() then
      v_status := 400;
      v_resp := jsonb_build_object('error', 'slot has already started');
    else
      begin
        insert into bookings (id, slot_id, name, email)
        values (gen_random_uuid()::text, p_slot_id, v_name, v_email)
        returning * into v_row;
        v_status := 201;
        v_resp := booking_json(v_row);
      exception when unique_violation then
        -- Level 3: another request got the slot first.
        v_status := 409;
        v_resp := jsonb_build_object('error', 'slot already booked');
      end;
    end if;
  end if;

  if p_key is not null then
    insert into idempotency (key, body_hash, status, response)
    values (p_key, p_hash, v_status, v_resp);
  end if;

  return jsonb_build_object('status', v_status, 'body', v_resp);
end $$;
