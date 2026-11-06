import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RoutePending } from "./components/route-pending";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Show the pending skeleton immediately on navigation (bug 17) instead
    // of leaving the previous page on screen while the next route loads.
    defaultPendingComponent: RoutePending,
    defaultPendingMs: 0,
  });

  return router;
};
