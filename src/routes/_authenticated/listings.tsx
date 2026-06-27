import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ComingSoon } from "@/components/coming-soon";
import { Tag } from "lucide-react";

export const Route = createFileRoute("/_authenticated/listings")({ component: () => (
  <AppShell title="Active listings" subtitle="Live eBay listings pushed from DropList">
    <ComingSoon icon={Tag} title="Active listings table coming next"
      body="View item IDs, traffic, sales and CJ stock for every listing. End or relist with one click." />
  </AppShell>
) });
