import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sin el indicador de Next en desarrollo: tapa contenido en la demo y en las capturas.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
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
