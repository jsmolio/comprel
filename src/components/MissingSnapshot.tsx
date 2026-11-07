/** Shown when this deployment has no published metagame. This is not an empty result set. */
export function MissingSnapshot({ reason }: { reason: string }) {
  return (
    <section className="max-w-2xl space-y-3 rounded-xl border border-amber-900/60 bg-amber-950/30 p-5">
      <h1 className="text-xl font-semibold text-amber-200">Metagame snapshot has not been published</h1>
      <p className="text-sm leading-6 text-neutral-300">
        This deployment is not showing an empty metagame. The site reads a versioned snapshot produced by the ingest
        workflow, and that file is not available yet.
      </p>
      <p className="text-sm leading-6 text-neutral-400">{reason}</p>
      <p className="text-sm leading-6 text-neutral-400">
        Build one from the public tournament cache with <code className="text-neutral-200">pnpm backfill</code>, or from
        an existing database with the read-only <code className="text-neutral-200">pnpm export-db</code>. See DEPLOY.md.
        Neither command is run automatically by loading this page.
      </p>
    </section>
  );
}
