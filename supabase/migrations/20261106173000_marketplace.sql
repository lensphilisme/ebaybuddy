-- Facebook Marketplace prepare/queue (Nov 6, 2026).
-- APPLY VIA THE SUPABASE DASHBOARD SQL EDITOR (the app cannot run DDL).
--
-- ARCHITECTURE: the Vercel app CANNOT post to Marketplace — Facebook's
-- Marketplace posting API is not open to third-party apps, and the
-- supported posting path in this environment is the facebook-cli on the
-- agent's VM (which shows the user an approval card per listing). So the
-- app only PREPARES listings and queues them as 'ready' rows here; the
-- agent posts them via facebook-cli and marks them 'posted' afterwards.
-- Nothing in this table ever publishes anything on its own.
create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_draft_id uuid references public.listing_drafts(id) on delete set null,
  cj_product_id text,
  title text not null,
  price numeric(10,2) not null default 0,
  description text not null default '',
  photos text[] not null default '{}',
  fb_category text not null default 'miscellaneous',
  condition text not null default 'new',
  latitude numeric,
  longitude numeric,
  location_label text,
  status text not null default 'ready' check (status in ('ready', 'posted', 'draft')),
  fb_listing_id text,
  fb_listing_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.marketplace_listings to authenticated;
grant all on public.marketplace_listings to service_role;
alter table public.marketplace_listings enable row level security;
create policy "Users manage own marketplace listings" on public.marketplace_listings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index marketplace_listings_user_status_idx on public.marketplace_listings(user_id, status, created_at desc);
create trigger marketplace_listings_updated_at before update on public.marketplace_listings for each row execute function public.set_updated_at();
