import type { NextConfig } from "next";

/**
 * Export statique : l'application est un ensemble de fichiers HTML/JS/CSS
 * servis par Cloudflare Pages (gratuit). Toute la logique serveur est dans
 * Supabase (PostgreSQL RPC + Realtime), aucun serveur Node n'est nécessaire.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
