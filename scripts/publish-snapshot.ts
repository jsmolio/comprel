// Rebuild data/published/snapshot.json from the local fact log. No network, no database.

import { classifierVersion } from "../src/lib/facts/classifier-version";
import { publishSnapshot } from "../src/lib/facts/publish";
import { FactStore, withPublishLock } from "../src/lib/facts/store";

async function main() {
  const store = new FactStore(process.cwd());
  const version = classifierVersion();
  await withPublishLock(store, async () => {
    const result = await publishSnapshot(store, { classifierVersion: version, log: (m) => console.log(m) });
    console.log(result.changed ? "✓ snapshot updated" : "✓ snapshot already current");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
