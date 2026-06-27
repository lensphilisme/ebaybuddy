import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ComingSoon } from "@/components/coming-soon";
import { FileEdit } from "lucide-react";

export const Route = createFileRoute("/_authenticated/drafts")({ component: () => (
  <AppShell title="Drafts" subtitle="Review, approve and bulk-push eBay listing drafts">
    <ComingSoon icon={FileEdit} title="Bulk draft builder coming next"
      body="Approve drafts individually or in bulk. Each draft carries pricing math, market comparables, image scoring and duplicate-listing signals before it leaves for eBay." />
  </AppShell>
) });
