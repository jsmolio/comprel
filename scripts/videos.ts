// Refresh YouTube gameplay videos for top archetypes.
//   YOUTUBE_API_KEY=... pnpm tsx scripts/videos.ts
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

import { refreshVideos } from "../src/lib/sources/youtube";
import { prisma } from "../src/lib/db";

refreshVideos({ log: (m) => console.log(m) })
  .then(async (n) => {
    console.log(`✓ stored ${n} videos`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
