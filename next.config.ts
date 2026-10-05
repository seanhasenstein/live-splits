import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Results imports post a whole meet's field (a few thousand rows) through a server action.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
