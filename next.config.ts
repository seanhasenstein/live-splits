import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Results imports post a whole meet's field (a few thousand rows) through a server action.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // pdf-parse loads pdf.js and its worker by file path at runtime; bundling it loses the worker.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // pdf.js reaches its worker through a dynamic import the tracer can't see, so the serverless
  // bundle for the import page (whose action parses PDFs) must carry the worker files explicitly.
  outputFileTracingIncludes: {
    "/meets/\\[meetId\\]/import": ["./node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "./node_modules/.pnpm/pdf-parse@*/node_modules/pdf-parse/dist/worker/pdf.worker.mjs"],
  },
};

export default nextConfig;
