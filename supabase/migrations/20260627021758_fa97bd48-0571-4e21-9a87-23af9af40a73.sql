
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.integration_provider AS ENUM ('ebay', 'cj', 'ai');
CREATE TYPE public.draft_status AS ENUM ('pending', 'approved', 'rejected', 'pushed', 'failed');
CREATE TYPE public.listing_status AS ENUM ('active', 'ended', 'sold', 'error');
CREATE TYPE public.log_level AS ENUM ('info', 'warn', 'error', 'success');

-- ============ updated_at helper ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  default_ebay_marketplace TEXT NOT NULL DEFAULT 'EBAY_US',
  ebay_environment TEXT NOT NULL DEFAULT 'production',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ============ Auto-create profile + default role on signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ INTEGRATION CREDENTIALS ============
CREATE TABLE public.integration_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider public.integration_provider NOT NULL,
  label TEXT,
  -- encrypted JSON blob of provider creds (refresh_token, client_id, api_key, etc.)
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  environment TEXT NOT NULL DEFAULT 'production',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_validated_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_credentials TO authenticated;
GRANT ALL ON public.integration_credentials TO service_role;
ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own creds" ON public.integration_credentials FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER integration_credentials_updated_at BEFORE UPDATE ON public.integration_credentials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ CJ PRODUCT CACHE ============
CREATE TABLE public.cj_products_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cj_product_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category_id TEXT,
  supplier_id TEXT,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  weight NUMERIC(10,3),
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_listed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, cj_product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cj_products_cache TO authenticated;
GRANT ALL ON public.cj_products_cache TO service_role;
ALTER TABLE public.cj_products_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own cj cache" ON public.cj_products_cache FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX cj_cache_user_idx ON public.cj_products_cache(user_id, created_at DESC);
CREATE TRIGGER cj_products_cache_updated_at BEFORE UPDATE ON public.cj_products_cache FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ LISTING DRAFTS ============
CREATE TABLE public.listing_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cj_product_id TEXT NOT NULL,
  cj_variant_id TEXT,
  sku TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT NOT NULL DEFAULT '',
  bullet_features TEXT[] NOT NULL DEFAULT '{}',
  item_specifics JSONB NOT NULL DEFAULT '{}'::jsonb,
  category_id TEXT,
  condition TEXT NOT NULL DEFAULT 'NEW',
  brand TEXT,
  model TEXT,
  quantity INT NOT NULL DEFAULT 1,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  profit JSONB NOT NULL DEFAULT '{}'::jsonb,
  market_comparison JSONB,
  duplicate_decision JSONB,
  status public.draft_status NOT NULL DEFAULT 'pending',
  audit_reason TEXT,
  ebay_listing_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_drafts TO authenticated;
GRANT ALL ON public.listing_drafts TO service_role;
ALTER TABLE public.listing_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own drafts" ON public.listing_drafts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX listing_drafts_user_status_idx ON public.listing_drafts(user_id, status, created_at DESC);
CREATE TRIGGER listing_drafts_updated_at BEFORE UPDATE ON public.listing_drafts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ EBAY LISTINGS ============
CREATE TABLE public.ebay_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  draft_id UUID REFERENCES public.listing_drafts(id) ON DELETE SET NULL,
  ebay_item_id TEXT,
  ebay_offer_id TEXT,
  sku TEXT NOT NULL,
  title TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  marketplace_id TEXT NOT NULL DEFAULT 'EBAY_US',
  status public.listing_status NOT NULL DEFAULT 'active',
  views INT NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  sales INT NOT NULL DEFAULT 0,
  last_traffic_check TIMESTAMPTZ,
  cj_product_id TEXT,
  cj_landed_cost NUMERIC(10,2),
  listed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ebay_listings TO authenticated;
GRANT ALL ON public.ebay_listings TO service_role;
ALTER TABLE public.ebay_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own listings" ON public.ebay_listings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX ebay_listings_user_status_idx ON public.ebay_listings(user_id, status, listed_at DESC);
CREATE TRIGGER ebay_listings_updated_at BEFORE UPDATE ON public.ebay_listings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ AUTOMATION RULES ============
CREATE TABLE public.automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  live_listing_enabled BOOLEAN NOT NULL DEFAULT false,
  preflight_required BOOLEAN NOT NULL DEFAULT true,
  markup_percent NUMERIC(5,2) NOT NULL DEFAULT 35.00,
  min_profit_usd NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  ebay_fee_buffer_percent NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  payment_fee_buffer_percent NUMERIC(5,2) NOT NULL DEFAULT 4.00,
  round_to NUMERIC(5,2) NOT NULL DEFAULT 0.99,
  max_listing_quantity INT NOT NULL DEFAULT 5,
  allow_subtitle BOOLEAN NOT NULL DEFAULT false,
  allow_bold_title BOOLEAN NOT NULL DEFAULT false,
  allow_promoted_listings BOOLEAN NOT NULL DEFAULT false,
  end_test_listings_after_success BOOLEAN NOT NULL DEFAULT false,
  optimizer_low_views_days INT NOT NULL DEFAULT 7,
  optimizer_no_sales_days INT NOT NULL DEFAULT 30,
  optimizer_poor_exposure_days INT NOT NULL DEFAULT 45,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_rules TO authenticated;
GRANT ALL ON public.automation_rules TO service_role;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own rules" ON public.automation_rules FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER automation_rules_updated_at BEFORE UPDATE ON public.automation_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ ACTIVITY LOGS ============
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level public.log_level NOT NULL DEFAULT 'info',
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own logs" ON public.activity_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own logs" ON public.activity_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own logs" ON public.activity_logs FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX activity_logs_user_created_idx ON public.activity_logs(user_id, created_at DESC);
