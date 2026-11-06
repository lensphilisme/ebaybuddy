import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — DropList" },
      { name: "description", content: "How DropList collects, uses, and protects your data when you connect eBay and CJ Dropshipping." },
    ],
  }),
  component: Privacy,
});

function Privacy() {
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
      <main className="max-w-3xl mx-auto px-6 py-12 prose prose-sm dark:prose-invert">
        <h1>Privacy Policy</h1>
        <p className="text-muted-foreground">Last updated: November 6, 2026. DropList (&ldquo;the app&rdquo;) helps you list CJ Dropshipping products on eBay.</p>

        <h2>What we collect</h2>
        <ul>
          <li>Your sign-in email and account details from Google or email sign-in, to identify your workspace.</li>
          <li>Your eBay and CJ Dropshipping connection credentials (API keys and OAuth tokens). They are stored encrypted, server-side, and are never shown back to you or anyone else.</li>
          <li>The listings, drafts, orders, and settings you create in the app.</li>
        </ul>

        <h2>How we use it</h2>
        <ul>
          <li>To connect to eBay and CJ Dropshipping on your behalf, only when you ask the app to (search products, create drafts, push listings, sync orders).</li>
          <li>To show you your own listings, orders, and activity inside the app.</li>
          <li>We do not sell, rent, or share your personal data with any third party for advertising.</li>
          <li>We do not send tracking data to eBay. Order tracking is handled by CJ Dropshipping, not by this app.</li>
        </ul>

        <h2>eBay data</h2>
        <p>When you connect your eBay account, the app requests permission to read and manage your own listings, orders, and returns, and to run Promoted Listings campaigns you create. The app only accesses the eBay data needed for the actions you choose. You can disconnect eBay at any time from Settings, which deletes the stored eBay tokens.</p>

        <h2>Data retention and deletion</h2>
        <p>Your data is kept while your account is active. You can ask for your account and its data to be deleted by contacting the app owner through the app. Credentials you remove in Settings are deleted from the app&apos;s storage.</p>

        <h2>Changes</h2>
        <p>If this policy changes, the updated version will be posted here with a new &ldquo;last updated&rdquo; date.</p>
      </main>
    </div>
  );
}
