import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

/**
 * Sync button with live progress (audit #2/#56): while a sync runs it shows
 * the elapsed time and a phase label ("checking offers…" / "checking
 * inventory…" / "refreshing traffic…") instead of a static "Syncing…",
 * so a ~4-minute sync never leaves the user with no feedback.
 *
 * The phase is ESTIMATED from elapsed time — the server function does not
 * stream progress. The sync checks offers first (bulk pages), falls back
 * to the inventory list when the offer list rejects every page, then
 * refreshes traffic. The labels follow that order; they are honest
 * estimates, not live server state.
 */
export function SyncButton({
  onSync,
  disabled,
  label = "Sync all from eBay",
}: {
  onSync: () => Promise<unknown>;
  disabled?: boolean;
  label?: string;
}) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const phase = elapsed < 20 ? "checking offers…" : elapsed < 120 ? "checking inventory…" : "refreshing traffic…";
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");

  async function run() {
    if (running) return;
    setRunning(true);
    setElapsed(0);
    timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      await onSync();
    } finally {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setRunning(false);
    }
  }

  return (
    <Button onClick={run} disabled={disabled || running} className="gap-2">
      <RefreshCw className={running ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
      {running ? `Syncing… ${phase} ${mm}:${ss}` : label}
    </Button>
  );
}
