import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// In production CloudFront serves the app, /api and /media from one origin, so
// there is no CORS layer anywhere. Dev proxies the same paths to CloudFront to
// keep that true locally -- otherwise the browser would make cross-origin
// calls the API deliberately does not allow.
const REQUIRED = [
  "VITE_AUTH_AUTHORITY",
  "VITE_AUTH_CLIENT_ID",
  "VITE_AUTH_DOMAIN",
] as const;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_PROXY_TARGET;

  // Vite inlines these at build time, so a missing value ships a bundle that
  // fails at sign-in with no clue why. Fail here instead.
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(", ")} in frontend/.env.local\n` +
        "  Generate it from the deployed stack:\n" +
        "    npx tsx backend/scripts/write-frontend-env.ts\n" +
        "  then rebuild. Env vars are baked in at build time, so the order matters.",
    );
  }

  return {
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
    server: {
      port: 5173,
      // Listen on all interfaces so a tunnel (or the LAN) can reach it.
      host: true,
      // Vite blocks unrecognised Host headers; a tunnel arrives with its own.
      allowedHosts: env.VITE_DEV_HOST ? [env.VITE_DEV_HOST] : undefined,
      // Without this, HMR tries ws:// on port 5173 through an HTTPS tunnel
      // and the page reloads constantly instead of hot-updating.
      hmr: env.VITE_DEV_HOST
        ? { protocol: "wss", host: env.VITE_DEV_HOST, clientPort: 443 }
        : undefined,
      proxy: target
        ? {
            "/api": { target, changeOrigin: true, secure: true },
            "/media": { target, changeOrigin: true, secure: true },
          }
        : undefined,
    },
  };
});
