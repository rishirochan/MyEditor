import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // ponytail: dev gets its own dir so `next build` can't stomp a running `next dev`
  // (and vice versa) — that collision is what makes .next errors come and go.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  serverExternalPackages: ["dockerode", "bullmq", "ioredis"],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
