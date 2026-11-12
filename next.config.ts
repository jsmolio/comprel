import path from "node:path";
import type { NextConfig } from "next";
import { assertPublishedTree } from "./src/lib/published/guard";
import { magicRedirects } from "./src/lib/routing";

assertPublishedTree(path.join(process.cwd(), "data/published/magic"), "data/published/magic");
assertPublishedTree(path.join(process.cwd(), "data/published/riftbound"), "data/published/riftbound");

const nextConfig: NextConfig = {
  // Dynamic routes read the split snapshots from disk at request time. Fully
  // static pages inline the files they touch at build. Include the trees so a
  // published snapshot is in the server trace.
  outputFileTracingIncludes: {
    "/*": ["./data/published/magic/**/*", "./data/published/riftbound/**/*"],
  },
  async redirects() {
    return magicRedirects();
  },
};

export default nextConfig;
