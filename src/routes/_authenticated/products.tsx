import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ComingSoon } from "@/components/coming-soon";
import { PackageSearch } from "lucide-react";

export const Route = createFileRoute("/_authenticated/products")({ component: () => (
  <AppShell title="CJ Products" subtitle="Search and cache CJ Dropshipping inventory">
    <ComingSoon
      icon={PackageSearch}
      title="CJ product search wires up next"
      body="Once your CJ access token is saved in Settings, this page lets you search by category, country, price, weight, rating and inventory — and turn winners into drafts."
    />
  </AppShell>
) });
