import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

/**
 * One shared empty state (icon + title + one-line help + optional action),
 * replacing the five ad-hoc versions across Dashboard, Drafts, Listings,
 * Optimizer, Orders, Marketing and Products.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  help,
  actionLabel,
  actionTo,
  onAction,
}: {
  icon?: LucideIcon;
  title: string;
  help?: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card px-4 py-12 text-center shadow-[var(--shadow-card)]">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {help ? <p className="max-w-sm text-sm text-muted-foreground">{help}</p> : null}
      {actionLabel ? (
        actionTo ? (
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link to={actionTo}>{actionLabel}</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="mt-2" onClick={onAction}>
            {actionLabel}
          </Button>
        )
      ) : null}
    </div>
  );
}
