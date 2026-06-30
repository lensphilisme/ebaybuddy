import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { connectEbayWithCode } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";

// Public route — eBay redirects the user here via the RuName mapping.
// If the user has a session in this tab we exchange the code automatically;
// otherwise we surface the raw code so they can paste it in Settings.
export const Route = createFileRoute("/ebay/callback")({
  component: EbayCallback,
  validateSearch: (s: Record<string, unknown>) => ({
    code: typeof s.code === "string" ? s.code : "",
    state: typeof s.state === "string" ? s.state : "",
    error: typeof s.error === "string" ? s.error : "",
    error_description: typeof s.error_description === "string" ? s.error_description : "",
  }),
});

function EbayCallback() {
  const { code, error, error_description } = Route.useSearch();
  const connect = useServerFn(connectEbayWithCode);
  const navigate = useNavigate();
  const [status, setStatus] = useState<"idle" | "checking" | "saving" | "saved" | "manual" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (error) {
      setStatus("error");
      setMessage(error_description || error);
      return;
    }
    if (!code) {
      setStatus("error");
      setMessage("No authorization code returned from eBay.");
      return;
    }
    (async () => {
      setStatus("checking");
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setStatus("manual");
        return;
      }
      try {
        setStatus("saving");
        await connect({ data: { code } });
        setStatus("saved");
        setTimeout(() => navigate({ to: "/settings" }), 1500);
      } catch (e) {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [code, error, error_description, connect, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background to-muted/30">
      <Card className="max-w-lg w-full p-8 space-y-4">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          {status === "saved" ? <CheckCircle2 className="text-success h-6 w-6" /> : status === "error" ? <AlertCircle className="text-destructive h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
          eBay authorization
        </h1>

        {status === "saving" || status === "checking" ? (
          <p className="text-sm text-muted-foreground">Exchanging code for tokens…</p>
        ) : status === "saved" ? (
          <p className="text-sm">Your eBay account is connected. Redirecting to Settings…</p>
        ) : status === "error" ? (
          <>
            <p className="text-sm text-destructive">{message}</p>
            <Button asChild variant="outline"><Link to="/settings">Back to Settings</Link></Button>
          </>
        ) : status === "manual" ? (
          <>
            <p className="text-sm">
              You're not signed into the app in this tab. Copy this code, return to{" "}
              <Link to="/settings" className="text-primary underline">Settings → eBay</Link> and paste it.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={code}
                className="flex-1 px-3 py-2 rounded-md border bg-muted font-mono text-xs truncate"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(code); toast.success("Code copied"); }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : null}
      </Card>
    </div>
  );
}
