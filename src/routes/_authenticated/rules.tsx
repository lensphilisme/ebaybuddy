import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ComingSoon } from "@/components/coming-soon";
import { Sliders } from "lucide-react";

export const Route = createFileRoute("/_authenticated/rules")({ component: () => (
  <AppShell title="Rules" subtitle="Pricing, profit floors, fee buffers and listing guardrails">
    <ComingSoon icon={Sliders} title="Rules editor coming next"
      body="Set markup %, min profit, fee buffers, price rounding and live-listing safety switch. Every draft respects the active rule set." />
  </AppShell>
) });
