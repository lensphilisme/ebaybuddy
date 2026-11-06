/**
 * Lightweight pending UI shown while a route chunk loads (bug 17).
 * TanStack Router keeps the previous page on screen while the next route's
 * code loads, so without this the app looks stuck on stale content for
 * 1–2s after every sidebar click.
 */
export function RoutePending() {
  return (
    <div className="min-h-screen flex flex-col bg-background" aria-live="polite" aria-label="Loading page">
      <div className="h-16 border-b border-border bg-card/80" />
      <div className="flex-1 p-4 lg:p-8 max-w-[1400px] w-full mx-auto">
        <div className="h-7 w-48 rounded-md bg-muted animate-pulse" />
        <div className="mt-2 h-4 w-72 max-w-full rounded-md bg-muted animate-pulse" />
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg border bg-card animate-pulse" />
          ))}
        </div>
        <div className="mt-6 h-64 rounded-lg border bg-card animate-pulse" />
      </div>
    </div>
  );
}
