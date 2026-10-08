import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Results imports post a whole meet's field (a few thousand rows) through a server action.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // pdf-parse loads pdf.js and its worker by file path at runtime; bundling it loses the worker.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
