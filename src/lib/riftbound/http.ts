export const RIFTBOUND_USER_AGENT = "comprel/1.0 (+https://github.com/jsmolio/comprel)";

export type PoliteResult =
  | { ok: true; status: 200; body: unknown; etag: string | null }
  | { ok: true; status: 304; etag: string | null }
  | { ok: false; kind: "not-found" | "rate-limit" | "unavailable" | "bad-shape"; status: number | null };

const sleepDefault = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(header: string | null, attempt: number): number {
  if (!header) return 400 * (attempt + 1);
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.max(0, Math.min(when - Date.now(), 60_000));
  return 400 * (attempt + 1);
}

/**
 * One JSON GET with an identifiable User-Agent. 429 waits for Retry-After.
 * 5xx and network errors back off. A 404 or a body that is not JSON does not retry.
 */
export async function fetchJsonPolite(
  url: string,
  opts: {
    userAgent?: string;
    etag?: string | null;
    maxAttempts?: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    timeoutMs?: number;
  } = {},
): Promise<PoliteResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? sleepDefault;
  const attempts = opts.maxAttempts ?? 4;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": opts.userAgent ?? RIFTBOUND_USER_AGENT,
  };
  if (opts.etag) headers["If-None-Match"] = opts.etag;

  let lastStatus: number | null = null;
  let sawRateLimit = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
      lastStatus = res.status;
      const etag = res.headers.get("etag");
      if (res.status === 304) return { ok: true, status: 304, etag };
      if (res.status === 404) return { ok: false, kind: "not-found", status: 404 };
      if (res.status === 429) {
        sawRateLimit = true;
        if (attempt === attempts - 1) return { ok: false, kind: "rate-limit", status: 429 };
        await sleep(retryAfterMs(res.headers.get("retry-after"), attempt));
        continue;
      }
      if (res.status >= 500) {
        if (attempt === attempts - 1) return { ok: false, kind: "unavailable", status: res.status };
        await sleep(400 * (attempt + 1));
        continue;
      }
      if (!res.ok) return { ok: false, kind: "bad-shape", status: res.status };
      const text = await res.text();
      try {
        return { ok: true, status: 200, body: JSON.parse(text) as unknown, etag };
      } catch {
        return { ok: false, kind: "bad-shape", status: res.status };
      }
    } catch {
      lastStatus = null;
      if (attempt === attempts - 1) {
        return { ok: false, kind: sawRateLimit ? "rate-limit" : "unavailable", status: lastStatus };
      }
      await sleep(400 * (attempt + 1));
    }
  }
  return { ok: false, kind: sawRateLimit ? "rate-limit" : "unavailable", status: lastStatus };
}
