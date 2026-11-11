import path from "node:path";
import type { NextConfig } from "next";
import { assertSnapshotFile } from "./src/lib/published/guard";
import { magicRedirects } from "./src/lib/routing";

assertSnapshotFile(path.join(process.cwd(), "data/published/snapshot.json"));
assertSnapshotFile(
  path.join(process.cwd(), "data/published/riftbound/snapshot.json"),
  "data/published/riftbound/snapshot.json",
);

const nextConfig: NextConfig = {
  // Dynamic routes read the snapshots from disk at request time. Fully static
  // pages inline them at build instead. Narrow include so the files are in the
  // server trace when a snapshot has been published.
  outputFileTracingIncludes: {
    "/*": ["./data/published/snapshot.json", "./data/published/riftbound/snapshot.json"],
  },
  async redirects() {
    return magicRedirects();
  },
};

export default nextConfig;
