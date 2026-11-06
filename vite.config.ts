// Standard TanStack Start + Vite config. No Lovable packages remain:
//   - tanstackStart: TanStack Start plugin (server entry is src/server.ts,
//     our SSR error wrapper)
//   - viteReact: React Fast Refresh / JSX
//   - tailwindcss: Tailwind v4
//   - tsConfigPaths: the "@" path alias from tsconfig.json
// Vite injects VITE_* env vars natively. Production builds use Nitro
// (already a devDependency); set NITRO_PRESET to pin a deploy target
// (e.g. "node-server", "vercel", "cloudflare-module") in your own CI.
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      server: { entry: "server" },
    }),
    viteReact(),
    tailwindcss(),
  ],
});
