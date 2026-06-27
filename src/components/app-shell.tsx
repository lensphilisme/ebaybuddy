import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  PackageSearch,
  FileEdit,
  Tag,
  LineChart,
  Settings2,
  ScrollText,
  Sliders,
  LogOut,
  Bell,
} from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { BrandLogo } from "./brand-logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/products", label: "CJ Products", icon: PackageSearch },
  { to: "/drafts", label: "Drafts", icon: FileEdit },
  { to: "/listings", label: "Listings", icon: Tag },
  { to: "/optimizer", label: "Optimizer", icon: LineChart },
  { to: "/rules", label: "Rules", icon: Sliders },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings2 },
] as const;

export function AppShell({ children, title, subtitle, actions }: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
          <Link to="/dashboard"><BrandLogo /></Link>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30 flex items-center px-4 lg:px-8 gap-4">
          <Link to="/dashboard" className="lg:hidden"><BrandLogo size="sm" /></Link>
          <div className="hidden md:block flex-1">
            <h1 className="text-lg font-semibold leading-none">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8 max-w-[1400px] w-full mx-auto">
          <div className="md:hidden mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
