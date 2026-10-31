import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

export function AsyncResult({ loading, error, retry }: { loading: boolean; error: Error | null; retry: () => void }) {
  if (loading) return <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading eBay data…</div>;
  if (!error) return null;
  return <div role="alert" className="flex flex-wrap items-center gap-3 border-l-2 border-destructive bg-destructive/5 p-4"><AlertCircle className="h-5 w-5 shrink-0 text-destructive" /><p className="min-w-0 flex-1 break-words text-sm">{error.message}</p><Button variant="outline" size="sm" onClick={retry}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></div>;
}