import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/logs")({ component: LogsPage });

function LogsPage() {
  const [category, setCategory] = useState("all");
  const [level, setLevel] = useState("all");
  const { data = [], isLoading } = useQuery({
    queryKey: ["activity-logs", category, level],
    queryFn: async () => {
      let q = supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(200);
      if (category !== "all") q = q.eq("category", category);
      if (level !== "all") q = q.eq("level", level as "success" | "info" | "warn" | "error");
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30_000,
  });
  const categories = useMemo(() => Array.from(new Set(data.map((l: any) => l.category).filter(Boolean))), [data]);

  return (
    <AppShell title="Activity logs" subtitle="Every CJ search, draft, push and optimizer action">
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All levels</SelectItem><SelectItem value="success">Success</SelectItem><SelectItem value="info">Info</SelectItem><SelectItem value="warn">Warn</SelectItem><SelectItem value="error">Error</SelectItem></SelectContent>
        </Select>
      </div>
      <Card className="overflow-hidden">
        {isLoading ? <div className="p-10"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : data.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground"><ScrollText className="h-8 w-8 mx-auto mb-2" />No logs match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Level</TableHead><TableHead>Category</TableHead><TableHead>Message</TableHead></TableRow></TableHeader>
              <TableBody>{data.map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</TableCell>
                  <TableCell><Badge variant={l.level === "error" ? "destructive" : "secondary"}>{l.level}</Badge></TableCell>
                  <TableCell className="text-xs uppercase text-muted-foreground">{l.category}</TableCell>
                  <TableCell className="min-w-64"><div className="font-medium">{l.message}</div>{l.metadata?.error && <div className="text-xs text-destructive mt-1 break-words">{l.metadata.error}</div>}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
