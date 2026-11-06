-- Money columns must be NUMERIC, not float4 (Nov 6, 2026).
--
-- APPLY VIA THE SUPABASE DASHBOARD SQL EDITOR (the app cannot run DDL).
--
-- Root cause of the "long float underneath" bug: listing_drafts.price and
-- automation_rules.round_to come back from the live DB as float32
-- artifacts (21.989999771118164, 0.9900000095367432) even though the repo
-- migration declares NUMERIC — the live schema drifted to float4 (real)
-- when the project was recreated. The forms already round the DISPLAY to
-- 2 decimals, but every save writes a double into a float4 column, which
-- round-trips back to the artifact. No form rounding can fix the STORED
-- value while the column is float4.
--
-- The cast below converts in place (21.989999771118164 -> 21.99); it is a
-- no-op for columns that are already NUMERIC. It is NOT a bulk UPDATE of
-- user data — it only changes the column type. After this, the form
-- load/save rounding (roundMoney / moneyInputValue) keeps the stored
-- values clean.
alter table public.listing_drafts
  alter column price type numeric(10,2);
alter table public.automation_rules
  alter column round_to type numeric(5,2),
  alter column min_profit_usd type numeric(10,2);
