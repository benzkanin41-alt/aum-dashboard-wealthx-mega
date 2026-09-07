import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  plugins: [
    react(),
    sites(),
    cloudflare({
      config: {
        name: "ltmh-wealthx-aum-aua",
        main: "./worker/index.ts",
        compatibility_date: "2026-05-22",
        compatibility_flags: ["nodejs_compat"],
        assets: {
          directory: "./dist/client",
          binding: "ASSETS",
          not_found_handling: "single-page-application",
          run_worker_first: ["/api/*"]
        },
        d1_databases: [{ binding: "DB", database_name: "sites-db", database_id: "00000000-0000-0000-0000-000000000000" }],
        r2_buckets: [{ binding: "FILES", bucket_name: "sites-files" }]
      }
    })
  ]
});
