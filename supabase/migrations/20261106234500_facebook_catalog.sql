-- Facebook Shop catalog feed (Nov 6, 2026).
-- APPLY VIA THE SUPABASE DASHBOARD SQL EDITOR (the app cannot run DDL).
--
-- ARCHITECTURE: Facebook Shops has no open product-push API for a
-- third-party app, so the app serves the catalog as a scheduled feed.
-- The public endpoint /api/facebook-catalog serves the INCLUDED rows
-- below as a Facebook catalog CSV, and Commerce Manager pulls it on a
-- schedule (daily). The "Facebook Catalog" page in the app is the
-- selection UI — unchecking a product drops it from the feed on the
-- next Facebook fetch. Nothing here posts anything to Facebook.
--
-- DATA: seeded from the Lisays Beauty Medusa storefront
-- (~/workspace/medusa-catalog/catalog.md, pulled Nov 6, 2026). ONLY the
-- 6 real products are seeded. The other 23 store products are dummy
-- data and must NEVER be added to this table. The casual sneaker is
-- real but TEST ONLY (is_test = true) — it ships in the feed for
-- testing and is removed later. Prices are the storefront prices
-- (USD); the feed does not reprice — Facebook Shops checks out on the
-- store website.
--
-- LIVE SYNC LIMITATION: this is seeded data, not a live Medusa sync.
-- If a price, title or image changes in Medusa, update the row here.
-- A live sync would read the Medusa Store API with the publishable key
-- from env — not built yet, and the key must never be hardcoded into
-- source.
create table if not exists public.facebook_catalog_items (
  id uuid primary key default gen_random_uuid(),
  medusa_handle text not null unique,
  title text not null,
  description text not null default '',
  link text not null,
  image_link text not null default '',
  brand text not null default 'Lisays Beauty',
  condition text not null default 'new',
  currency text not null default 'USD',
  variants jsonb not null default '[]'::jsonb,
  included boolean not null default true,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.facebook_catalog_items to authenticated;
grant all on public.facebook_catalog_items to service_role;
alter table public.facebook_catalog_items enable row level security;
create policy "Signed-in users manage the Facebook catalog" on public.facebook_catalog_items for all to authenticated using (true) with check (true);
create trigger facebook_catalog_items_updated_at before update on public.facebook_catalog_items for each row execute function public.set_updated_at();

-- Variants JSONB shape: [{"key": "default", "label": "", "price": 37.47,
-- "availability": "in_stock"}]. One feed row is emitted per variant
-- entry; a single "default" entry means one row for the whole product.
-- Prices are numbers; the feed formats them as "37.47 USD".

-- 24. African Women Wig — flat $37.47, all 10 sizes.
insert into public.facebook_catalog_items (medusa_handle, title, description, link, image_link, variants)
values (
  'african-women-wig-long-straight-hair-lace-hair-cover',
  'African Women Wig Long Straight Hair Lace Hair Cover',
  $$Product information: Treatment Process: Mechanism Color: 14 inches, 16 inches, 18 inches, 20 inches, 22 inches, 24 inches, 26 inches, 28 inches, 30 inches, 32 inches Applicable face type: any face type Wig style: long straight hair long bangs Applicable people: Ladies Hair material: high temperature fiber Applicable skin color: any skin color Style: Exotic Hair dye and Perm or not: non-hot dye Packing list: Wig set ×1$$,
  'https://app-base-jet.vercel.app/shop/african-women-wig-long-straight-hair-lace-hair-cover',
  'https://cf.cjdropshipping.com/quick/product/7e2ede28-f599-47a2-9aaa-6ff43ef1549e.jpg',
  '[{"key":"default","label":"","price":37.47,"availability":"in_stock"}]'::jsonb
)
on conflict (medusa_handle) do nothing;

-- 25. Cute Cartoon Cotton Slippers — flat $19.69, 5 sizes x 6 colors.
-- Out of stock: sizes 36to37/38to39 in Pink/Khaki/White/Green (disabled
-- in the storefront picker); everything else was selectable.
insert into public.facebook_catalog_items (medusa_handle, title, description, link, image_link, variants)
select
  'cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl',
  'Cute Cartoon Cotton Slippers Thick Bottom Home Slippers Fashion Floor Bedroom Slipper Women Men Couples Warm House Shoes',
  $$Overview: Unique design, stylish and beautiful. Good material, comfortable wear. A variety of colors, any choice. Product information: Color: pink, khaki, white, green, gray, coffee Heel shape: flat heel Size: 36–37, 38–39, 40–41, 42–43, 44–45 Sole material: PVC Toe holder shape: round head Shoe Upper material: Plush Wearing method: oversleeves/shoe covers Applicable gender: neutral/both men and women$$,
  'https://app-base-jet.vercel.app/shop/cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl',
  'https://cf.cjdropshipping.com/quick/product/d6d5e3f0-4b7e-4972-804b-4d86b5d63a3b.jpg',
  (
    select jsonb_agg(
      jsonb_build_object(
        'key', lower(s || '-' || c),
        'label', s || ' / ' || c,
        'price', 19.69,
        'availability', case when s in ('36to37', '38to39') and c in ('Pink', 'Khaki', 'White', 'Green') then 'out_of_stock' else 'in_stock' end
      ) order by s, c
    )
    from (values ('36to37'), ('38to39'), ('40to41'), ('42to43'), ('44to45')) as sizes(s)
    cross join (values ('Pink'), ('Khaki'), ('White'), ('Green'), ('Gray'), ('Coffee')) as colors(c)
  )
on conflict (medusa_handle) do nothing;

-- 26. Eelhoe Ginger Hair Essential Oil — per-quantity prices.
insert into public.facebook_catalog_items (medusa_handle, title, description, link, image_link, variants)
values (
  'eelhoe-ginger-hair-essential-oil-eelhoe-ginger-hair-essential-oil',
  'Eelhoe Ginger Hair Essential Oil',
  $$Our ginger hair essential oil contains soil leaf extract, ginseng extract. It prevents shedding, fixes hair and hair development. Its use method is very simple: wash, wipe your hair, take an appropriate amount of this product, massage gently, evenly apply to the scalp, so that the product can penetrate into the hair. And can moisturize hair, protect hair, not easy to lose hair.$$,
  'https://app-base-jet.vercel.app/shop/eelhoe-ginger-hair-essential-oil-eelhoe-ginger-hair-essential-oil',
  'https://cf.cjdropshipping.com/c292780b-c066-4ff9-a75b-06cf92378d43.jpg',
  '[{"key":"1pc","label":"1pc","price":13.78,"availability":"in_stock"},{"key":"2pcs","label":"2pcs","price":19.29,"availability":"in_stock"},{"key":"3pcs","label":"3pcs","price":24.82,"availability":"in_stock"},{"key":"4pcs","label":"4pcs","price":33.07,"availability":"in_stock"}]'::jsonb
)
on conflict (medusa_handle) do nothing;

-- 27. Batana Oil — per-variant prices.
insert into public.facebook_catalog_items (medusa_handle, title, description, link, image_link, variants)
values (
  'batana-oil-hair-care-essential-oil-batana-oil-hair-oil',
  'Batana Oil Hair Care Essential Oil Batana Oil Hair Oil',
  $$Product information: Efficacy: moisturizing and nourishing, hair dye protection, tough and anti-hair break, improve frizzy hair Applicable people: Youth Applicable gender: general Net content: Batana essential oil 118ml, Batana essential oil 60ml Packing list: Hair care Essential oil *1$$,
  'https://app-base-jet.vercel.app/shop/batana-oil-hair-care-essential-oil-batana-oil-hair-oil',
  'https://cf.cjdropshipping.com/quick/product/1706dbf1-97de-49d8-aa3d-0d5a64c22823.jpg',
  '[{"key":"118ml","label":"Batana Essential Oil 118ml","price":18.10,"availability":"in_stock"},{"key":"60ml","label":"Batana Essential Oil 60ml","price":16.15,"availability":"in_stock"},{"key":"brown","label":"brown","price":16.59,"availability":"in_stock"},{"key":"set1","label":"Set1","price":21.67,"availability":"in_stock"},{"key":"set2","label":"Set2","price":18.46,"availability":"in_stock"},{"key":"set3","label":"Set3","price":24.89,"availability":"in_stock"}]'::jsonb
)
on conflict (medusa_handle) do nothing;

-- 28. Wigs real hair India hair — per-length prices.
insert into public.facebook_catalog_items (medusa_handle, title, description, link, image_link, variants)
values (
  'wigs-real-hair-india-hair-ladies-water-wave-hair-hair',
  'Wigs real hair India hair ladies water wave hair hair',
  $$Hairline material: real human hairline [Name] water wave hair weave [Material] Human hair [Specification] 12–28 inch [Color] 1B natural color [Weight] 100g±5g/each$$,
  'https://app-base-jet.vercel.app/shop/wigs-real-hair-india-hair-ladies-water-wave-hair-hair',
  'https://cf.cjdropshipping.com/20210122/4110045771683.jpg',
  '[{"key":"12-inch","label":"12 inch","price":37.19,"availability":"in_stock"},{"key":"14-inch","label":"14 inch","price":42.74,"availability":"in_stock"},{"key":"16-inch","label":"16 inch","price":48.30,"availability":"in_stock"},{"key":"18-inch","label":"18 inch","price":53.85,"availability":"in_stock"},{"key":"20-inch","label":"20 inch","price":59.40,"availability":"in_stock"},{"key":"22-inch","label":"22 inch","price":64.97,"availability":"in_stock"},{"key":"24-inch","label":"24 inch","price":70.52,"availability":"in_stock"},{"key":"26-inch","label":"26 inch","price":78.86,"availability":"in_stock"}]'::jsonb
)
on conflict (medusa_handle) do nothing;

-- 29. Women Shoes Female Casual Shoes — TEST ONLY (is_test = true).
-- Real product, included in the feed for testing; remove later.
insert into public.facebook_catalog_items (medusa_handle, title, description, link, image_link, variants, is_test)
values (
  'women-shoes-female-casual-shoes',
  'Women Shoes Female Casual Shoes',
  $$Heel: 3.5cm US Size 5.5 6 6.5 7 8 8.5 CN Size 35 36 37 38 39 40 Inner Length(cm) 220 225 230 235 240 245$$,
  'https://app-base-jet.vercel.app/shop/women-shoes-female-casual-shoes',
  'https://cf.cjdropshipping.com/20200902/5794212741340.jpg',
  '[{"key":"default","label":"","price":33.58,"availability":"in_stock"}]'::jsonb,
  true
)
on conflict (medusa_handle) do nothing;
