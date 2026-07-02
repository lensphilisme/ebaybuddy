import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { runOptimizerRules } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Play, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/optimizer")({ component: OptimizerPage });

function OptimizerPage() {
  const runFn = useServerFn(runOptimizerRules);
  const [actions, setActions] = useState<any[]>([]);

  const { data: listings = [], refetch } = useQuery({
    queryKey: ["ebay-listings-optimizer"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ebay_listings").select("*").order("listed_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const run = useMutation({
    mutationFn: (dryRun: boolean) => runFn({ data: { dryRun } }),
    onSuccess: (rows: any[], dryRun) => {
      setActions(rows);
      toast.success(`${dryRun ? "Preview" : "Applied"} · ${rows.length} action(s)`);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Optimizer" subtitle="AI-driven rules that end dead listings and rewrite low-CTR titles">
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Active listings</div>
          <div className="text-2xl font-semibold">{listings.filter((l: any) => l.status === "active").length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Flagged to end</div>
          <div className="text-2xl font-semibold">{listings.filter((l: any) => l.status === "flagged_end").length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total sales</div>
          <div className="text-2xl font-semibold">{listings.reduce((s: number, l: any) => s + (l.sales || 0), 0)}</div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending}>
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />} Preview AI actions
        </Button>
        <Button onClick={() => run.mutate(false)} disabled={run.isPending}>
          <Play className="h-4 w-4 mr-1" /> Run now
        </Button>
      </div>

      <Card className="overflow-hidden">
        {actions.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <LineChart className="h-8 w-8 mx-auto mb-2 opacity-60" />
            No actions yet. Click <strong>Preview AI actions</strong> to see what the optimizer would do based on your Rules.
          </div>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Listing</TableHead><TableHead>Action</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
            <TableBody>
              {actions.map((a, i) => (
                <TableRow key={a.id + i}>
                  <TableCell className="max-w-md line-clamp-2">{a.title}</TableCell>
                  <TableCell><Badge variant={a.action === "end_recommended" ? "destructive" : "secondary"}>{a.action}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </AppShell>
  );
}
