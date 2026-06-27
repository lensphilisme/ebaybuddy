import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ComingSoon } from "@/components/coming-soon";
import { ScrollText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/logs")({ component: () => (
  <AppShell title="Activity logs" subtitle="Every CJ search, draft, push and end-of-listing action">
    <ComingSoon icon={ScrollText} title="Logs viewer coming next"
      body="Filter by level, category and date. Logs help you audit any automated action DropList took." />
  </AppShell>
) });
