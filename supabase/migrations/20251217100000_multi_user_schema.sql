-- Multi-user schema for Sustainable Shop
-- Adds user accounts, their AH credentials, and purchase history
-- Keeps products as a global product catalog fed by all users

begin;

-- ============================================================================
-- USERS TABLE
-- Stores user account information (uses Supabase Auth UUID as foreign key)
-- ============================================================================
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.users enable row level security;

-- Users can only see and update their own record
drop policy if exists "Users can view own profile" on public.users;
create policy "Users can view own profile" on public.users
  for select using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.users;
create policy "Users can update own profile" on public.users
  for update using (auth.uid() = id);

-- ============================================================================
-- USER_AH_CREDENTIALS TABLE
-- Stores encrypted AH login credentials per user
-- In production, consider using Supabase Vault for sensitive data
-- ============================================================================
create table if not exists public.user_ah_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ah_email text not null,
  -- Cookies stored as encrypted JSON (encrypt in application layer)
  cookies_encrypted text,
  cookies_updated_at timestamptz,
  last_sync_at timestamptz,
  sync_status text default 'never_synced' check (sync_status in ('never_synced', 'success', 'failed', 'in_progress')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)  -- One AH account per user for now
);

create index if not exists user_ah_credentials_user_id_idx on public.user_ah_credentials(user_id);

-- Enable Row Level Security
alter table public.user_ah_credentials enable row level security;

-- Users can only access their own credentials
drop policy if exists "Users can view own AH credentials" on public.user_ah_credentials;
create policy "Users can view own AH credentials" on public.user_ah_credentials
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own AH credentials" on public.user_ah_credentials;
create policy "Users can insert own AH credentials" on public.user_ah_credentials
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own AH credentials" on public.user_ah_credentials;
create policy "Users can update own AH credentials" on public.user_ah_credentials
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own AH credentials" on public.user_ah_credentials;
create policy "Users can delete own AH credentials" on public.user_ah_credentials
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- USER_PURCHASES TABLE
-- Stores each user's purchase history with references to global product catalog
-- ============================================================================
create table if not exists public.user_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_id text not null,  -- References products.id (the global catalog)
  product_name text not null,  -- Denormalized for quick display
  product_url text,
  product_image_url text,
  price numeric(10, 2),  -- Price at time of purchase
  quantity integer default 1,
  purchased_at timestamptz,  -- When the user bought it (if known from receipt)
  scraped_at timestamptz not null default now(),  -- When we scraped this data
  source text default 'ah_scrape',  -- 'ah_scrape', 'manual', 'receipt'
  receipt_id text,  -- Optional: link to a receipt if we have receipt data
  created_at timestamptz not null default now()
);

create index if not exists user_purchases_user_id_idx on public.user_purchases(user_id);
create index if not exists user_purchases_product_id_idx on public.user_purchases(product_id);
create index if not exists user_purchases_scraped_at_idx on public.user_purchases(scraped_at desc);
create index if not exists user_purchases_user_product_idx on public.user_purchases(user_id, product_id);

-- Enable Row Level Security
alter table public.user_purchases enable row level security;

-- Users can only access their own purchases
drop policy if exists "Users can view own purchases" on public.user_purchases;
create policy "Users can view own purchases" on public.user_purchases
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own purchases" on public.user_purchases;
create policy "Users can insert own purchases" on public.user_purchases
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own purchases" on public.user_purchases;
create policy "Users can delete own purchases" on public.user_purchases
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- UPDATE products TABLE
-- Add price column and contributor tracking
-- ============================================================================
alter table public.products 
  add column if not exists price numeric(10, 2),
  add column if not exists first_seen_at timestamptz default now(),
  add column if not exists last_seen_at timestamptz default now(),
  add column if not exists seen_count integer default 1,
  add column if not exists contributed_by uuid[];  -- Array of user IDs who contributed this product

-- Index for analytics
create index if not exists products_last_seen_idx on public.products(last_seen_at desc);

-- ============================================================================
-- AGGREGATE VIEWS FOR ANALYTICS
-- ============================================================================

-- View: Product popularity across all users
drop view if exists public.product_popularity;
create or replace view public.product_popularity as
select 
  p.id,
  p.name,
  p.normalized_name,
  p.url,
  p.image_url,
  p.price,
  p.seen_count,
  coalesce(array_length(p.contributed_by, 1), 0) as unique_buyers,
  p.first_seen_at,
  p.last_seen_at
from public.products p
order by p.seen_count desc;

-- View: User purchase summary (respects RLS)
drop view if exists public.user_purchase_summary;
create or replace view public.user_purchase_summary as
select 
  user_id,
  count(*) as total_purchases,
  count(distinct product_id) as unique_products,
  sum(price * quantity) as total_spent,
  min(scraped_at) as first_purchase_scraped,
  max(scraped_at) as last_purchase_scraped
from public.user_purchases
where auth.uid() = user_id
group by user_id;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to upsert a product to global catalog and record user purchase
create or replace function public.record_user_purchase(
  p_user_id uuid,
  p_product_id text,
  p_product_name text,
  p_normalized_name text,
  p_product_url text,
  p_product_image_url text,
  p_price numeric,
  p_source text default 'ah_scrape'
) returns uuid as $$
declare
  v_purchase_id uuid;
begin
  -- Upsert to global product catalog
  insert into public.products (id, name, normalized_name, url, image_url, price, source, seen_count, contributed_by, last_seen_at)
  values (p_product_id, p_product_name, p_normalized_name, p_product_url, p_product_image_url, p_price, p_source, 1, array[p_user_id], now())
  on conflict (id) do update set
    name = coalesce(excluded.name, products.name),
    normalized_name = coalesce(excluded.normalized_name, products.normalized_name),
    url = coalesce(excluded.url, products.url),
    image_url = coalesce(excluded.image_url, products.image_url),
    price = coalesce(excluded.price, products.price),
    seen_count = products.seen_count + 1,
    last_seen_at = now(),
    contributed_by = (
      select array_agg(distinct u) 
      from unnest(array_cat(products.contributed_by, array[p_user_id])) as u
    ),
    updated_at = now();

  -- Record user purchase
  insert into public.user_purchases (user_id, product_id, product_name, product_url, product_image_url, price, source)
  values (p_user_id, p_product_id, p_product_name, p_product_url, p_product_image_url, p_price, p_source)
  returning id into v_purchase_id;

  return v_purchase_id;
end;
$$ language plpgsql security definer;

-- Function to update user's last sync time
create or replace function public.update_user_sync_status(
  p_user_id uuid,
  p_status text,
  p_sync_time timestamptz default now()
) returns void as $$
begin
  update public.user_ah_credentials
  set 
    sync_status = p_status,
    last_sync_at = case when p_status = 'success' then p_sync_time else last_sync_at end,
    updated_at = now()
  where user_id = p_user_id;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_updated_at on public.users;
create trigger users_updated_at
  before update on public.users
  for each row execute function public.update_updated_at();

drop trigger if exists user_ah_credentials_updated_at on public.user_ah_credentials;
create trigger user_ah_credentials_updated_at
  before update on public.user_ah_credentials
  for each row execute function public.update_updated_at();

-- Auto-create user profile when auth user is created
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

-- Only create trigger if it doesn't exist
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;

commit;
