-- Sales-features pass (Nov 6, 2026): new Rules settings + threshold fix.
-- APPLY VIA THE SUPABASE DASHBOARD SQL EDITOR (the app cannot run DDL).
-- Until this is applied, the new settings read as their code defaults and
-- saving them errors with a clear message (never silently).
-- Best Offer on new pushes (default ON, floor 80% of sell price).
alter table public.automation_rules
  add column if not exists best_offer_enabled boolean not null default true,
  add column if not exists best_offer_min_percent int not null default 80;
-- Price-drop ladder in the optimizer (default ON, total cap 20%).
alter table public.automation_rules
  add column if not exists optimizer_price_drop_enabled boolean not null default true,
  add column if not exists optimizer_price_drop_max_percent int not null default 20;
-- Promoted auto-rules (default OFF — ads spend real money, opt-in only).
alter table public.automation_rules
  add column if not exists promoted_auto_enabled boolean not null default false,
  add column if not exists promoted_auto_max_rate_percent int not null default 10;
-- Poor-exposure flag day must come BEFORE the end day (audit #44): the old
-- default 45d flagged a listing AFTER it was ended at 30d. New default 14d.
alter table public.automation_rules
  alter column optimizer_poor_exposure_days set default 14;
-- One-time fix for rows still on the exact old contradictory defaults
-- (end 30 / rewrite 7 / flag 45): move only the flag to 14. Any other
-- saved values are left untouched.
update public.automation_rules
  set optimizer_poor_exposure_days = 14
  where optimizer_no_sales_days = 30
    and optimizer_low_views_days = 7
    and optimizer_poor_exposure_days = 45;
-- "End test listings after first sale" is dead (no "test listing" exists
-- in the app) — remove the switch and its column.
alter table public.automation_rules
  drop column if exists end_test_listings_after_success;
