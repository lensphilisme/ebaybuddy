import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, ShieldCheck, Sparkles, TrendingUp, Zap } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import homeProducts from "@/assets/home-products.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DropList — Your CJ-to-eBay selling workspace" },
      { name: "description", content: "Discover CJ products, prepare optimized drafts and publish to your own eBay account with DropList." },
      { property: "og:title", content: "DropList — Your CJ-to-eBay selling workspace" },
      { property: "og:description", content: "Discover CJ products, prepare optimized drafts and publish to your own eBay account with DropList." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="home-screen bg-background text-foreground">
      <header className="home-header border-b border-border">
        <Link to="/" aria-label="DropList home" className="min-w-0"><BrandLogo /></Link>
        <nav aria-label="Account" className="flex shrink-0 items-center gap-2">
          <Button asChild variant="ghost" size="sm"><Link to="/auth">Sign in</Link></Button>
          <Button asChild size="sm"><Link to="/auth">Get started <ArrowRight /></Link></Button>
        </nav>
      </header>

      <main className="home-main">
        <section className="home-hero" aria-labelledby="home-title">
          <img src={homeProducts} alt="Headphones, a lamp, a bottle and clothing beside a shipping box" width={1536} height={1024} className="home-photo" />
          <div className="home-image-shade" />
          <div className="home-copy">
            <div className="home-eyebrow"><span className="home-status-dot" /> CJ DROPSHIPPING <ArrowRight className="h-3 w-3" /> EBAY</div>
            <h1 id="home-title">DropList<span>Your next listing.<br />Your next opportunity.</span></h1>
            <p className="home-description">Discover products. Price for profit.<br />Make them yours on eBay.</p>
            <div className="home-cta">
              <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90"><Link to="/auth">Start listing <ArrowRight /></Link></Button>
              <span className="home-security"><ShieldCheck className="h-4 w-4 shrink-0" /> Your account. Your business.</span>
            </div>
          </div>
          <div className="home-photo-caption"><Boxes className="h-4 w-4" /><span>From discovery to your storefront.</span></div>
        </section>

        <section className="home-workflow" aria-label="Your selling workflow">
          {[
            { Icon: Boxes, label: "Discover", detail: "Find your next product", number: "01" },
            { Icon: Sparkles, label: "Prepare", detail: "Make every listing count", number: "02" },
            { Icon: TrendingUp, label: "Publish", detail: "Grow your eBay storefront", number: "03" },
          ].map(({ Icon, label, detail, number }) => (
            <Link key={label} to="/auth" className="home-step group">
              <span className="home-step-number">{number}</span>
              <Icon className="home-step-icon" />
              <div className="min-w-0"><h2>{label}</h2><p>{detail}</p></div>
              <ArrowRight className="home-step-arrow transition-transform group-hover:translate-x-1" />
            </Link>
          ))}
        </section>
      </main>

      <footer className="home-footer text-muted-foreground">
        <span className="flex items-center gap-1.5"><Zap className="h-3 w-3 text-primary" /> Built for independent sellers</span>
        <span>Not affiliated with eBay or CJ Dropshipping.</span>
      </footer>
    </div>
  );
}
