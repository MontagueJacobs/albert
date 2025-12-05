-- User profiles and per-user products for Sustainable Shop

begin;

-- Profiles: one row per auth user, stores ingest key used by bookmarklet/extension
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  ingest_key text unique not null
);

-- Per-user products (scraped items)
create table if not exists public.user_products (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  normalized_name text not null,
  url text,
  image_url text,
  price numeric,
  source text,
  tags jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.user_products enable row level security;

-- Policies: allow users to manage their own profile row
create policy if not exists profiles_select_self on public.profiles
  for select using (auth.uid() = user_id);
create policy if not exists profiles_upsert_self on public.profiles
  for insert with check (auth.uid() = user_id);
create policy if not exists profiles_update_self on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Policies: per-user product visibility (read-own only). Writes happen via service role.
create policy if not exists user_products_select_self on public.user_products
  for select using (auth.uid() = user_id);

commit;
