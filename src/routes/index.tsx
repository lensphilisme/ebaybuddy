import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, Gauge, LineChart, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "DropList — Bulk-list CJ Dropshipping products to eBay" },
      { name: "description", content: "Find winning CJ Dropshipping products, build optimized eBay drafts, and bulk-push to your eBay account with smart pricing and market research." },
      { property: "og:title", content: "DropList — Bulk-list CJ Dropshipping products to eBay" },
      { property: "og:description", content: "Find winning CJ Dropshipping products, build optimized eBay drafts, and bulk-push to your eBay account with smart pricing and market research." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/"><BrandLogo /></Link>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost"><Link to="/auth">Sign in</Link></Button>
            <Button asChild><Link to="/auth">Get started</Link></Button>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden" style={{ background: "var(--gradient-hero)" }}>
        <div className="max-w-7xl mx-auto px-6 py-20 lg:py-28 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground mb-6">
              <Sparkles className="h-3.5 w-3.5 text-[var(--brand-blue)]" />
              CJ Dropshipping → eBay, automated
            </div>
            <h1 className="text-4xl lg:text-6xl font-extrabold tracking-tight leading-[1.05]">
              List smarter on eBay.
              <span className="block text-transparent bg-clip-text" style={{ backgroundImage: "var(--gradient-brand)" }}>
                Sell faster.
              </span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-xl">
              DropList fetches CJ Dropshipping products, builds eBay-ready drafts with smart pricing
              and real market research, then bulk-pushes them to your eBay account — and keeps
              optimizing after they go live.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="gap-2">
                <Link to="/auth">Start listing <ArrowRight className="h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/auth">Sign in</Link>
              </Button>
            </div>
            <div className="mt-8 flex items-center gap-6 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-[var(--brand-green)]" /> Your credentials stay encrypted, server-side</span>
            </div>
          </div>

          <div className="relative">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-elevated)]">
              <div className="text-sm font-semibold mb-4">How it works</div>
              <div className="space-y-3">
                {[
                  { Icon: Boxes, t: "Search CJ", d: "Find products by keyword, category, country, and price." },
                  { Icon: Sparkles, t: "Build drafts", d: "AI titles, item specifics, and smart pricing from your rules." },
                  { Icon: Zap, t: "Push to eBay", d: "Preflight checks, then bulk-push through the Inventory API." },
                  { Icon: LineChart, t: "Optimize & sync", d: "Sync views, clicks, and sales; the optimizer flags what to fix." },
                ].map(({ Icon, t, d }) => (
                  <div key={t} className="flex items-start gap-3 rounded-lg border border-border px-4 py-3">
                    <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div>
                    <div>
                      <div className="text-sm font-medium">{t}</div>
                      <div className="text-xs text-muted-foreground">{d}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">Your own drafts appear here after you sign in.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-20 grid md:grid-cols-3 gap-6">
        {[
          { Icon: Boxes, t: "Fetch CJ inventory", d: "Search CJ Dropshipping by keyword, category, country, and price — cache only the winners." },
          { Icon: Zap, t: "Bulk-list to eBay", d: "Generate optimized drafts, approve in one click, push to your eBay account via the Inventory API." },
          { Icon: LineChart, t: "Optimize after launch", d: "Track views, clicks, and sales; the optimizer recommends rewrites, price moves, or ending a listing." },
        ].map(({ Icon, t, d }) => (
          <div key={t} className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
            <h3 className="mt-4 font-semibold text-lg">{t}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </section>

      <section className="border-t border-border bg-secondary/40">
        <div className="max-w-7xl mx-auto px-6 py-16 flex flex-col items-center text-center gap-6">
          <Gauge className="h-10 w-10 text-primary" />
          <h2 className="text-3xl font-bold tracking-tight">Built for safe, profitable bulk listing.</h2>
          <p className="max-w-2xl text-muted-foreground">
            Pricing respects min profit, fee buffers, and rounded ladders. Drafts run duplicate checks
            against your active listings. Live pushes are off until you flip the safety switch.
          </p>
          <Button asChild size="lg"><Link to="/auth">Create your workspace</Link></Button>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <BrandLogo size="sm" />
          <span>© {new Date().getFullYear()} DropList. Not affiliated with eBay or CJ Dropshipping.</span>
        </div>
      </footer>
    </div>
  );
}
