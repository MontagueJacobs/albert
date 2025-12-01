-- Initial catalog schema for Sustainable Shop
-- Creates product_catalog (curated items) and ah_products (scraped items)

begin;

create table if not exists public.product_catalog (
  id text primary key,
  names text[] not null,
  base_score integer not null default 5 check (base_score between 0 and 10),
  categories text[] not null default '{}',
  adjustments jsonb not null default '[]',
  suggestions text[] not null default '{}',
  notes text
);

-- Basic index to help search by name terms if needed
create index if not exists product_catalog_gin_names on public.product_catalog using gin (names);

create table if not exists public.ah_products (
  id text primary key,
  name text not null,
  normalized_name text not null,
  url text,
  image_url text,
  source text,
  tags jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists ah_products_normalized_name_idx on public.ah_products (normalized_name);

commit;
