import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The /api/ingest route reads archetype rules from data/ at runtime; make sure
  // those files ship with the serverless function when deployed.
  outputFileTracingIncludes: {
    "/api/ingest": ["./data/**/*"],
  },
};

export default nextConfig;
