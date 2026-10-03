import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/aum-dashboard-wealthx-mega/",
  envDir: false,
  publicDir: false,
  plugins: [react()],
  define: {
    "import.meta.env.VITE_DASHBOARD_API_ORIGIN": JSON.stringify(
      "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site"
    )
  },
  build: {
    outDir: "dist-pages",
    emptyOutDir: true
  }
});
