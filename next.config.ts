import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dynamic routes read the snapshot from disk at request time. Fully static
  // pages inline it at build instead. Narrow include so the file is in the
  // server trace when a snapshot has been published.
  outputFileTracingIncludes: {
    "/*": ["./data/published/snapshot.json"],
  },
};

export default nextConfig;
