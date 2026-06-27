import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ComingSoon } from "@/components/coming-soon";
import { LineChart } from "lucide-react";

export const Route = createFileRoute("/_authenticated/optimizer")({ component: () => (
  <AppShell title="Optimizer" subtitle="Listing-by-listing recommendations from real signals">
    <ComingSoon icon={LineChart} title="Smart optimizer wires up next"
      body="Reads views, clicks, CTR, sales, CJ stock, cost changes and competitor moves — then recommends a rewrite, price move, image swap, or end-of-listing." />
  </AppShell>
) });
