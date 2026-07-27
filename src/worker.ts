/**
 * Submit relay for the public job-order wizard.
 *
 * WHY THIS EXISTS. This site is public and its Vite bundle is public with it —
 * anything in `import.meta.env` ships to the browser. So the form cannot hold
 * the credential needed to write into Azure. It posts same-origin to /submit
 * instead, and this Worker — which runs server-side and CAN hold a secret —
 * attaches it and forwards to the recruiting dashboard's secret-gated intake
 * endpoint.
 *
 * The recruiting side verifies X-Home-Proxy-Secret against RECRUITING_PROXY_SECRET
 * with a constant-time compare and fails closed. Keep the header name in step
 * with api/shared/internal_jo.py:proxy_secret_ok in that repo.
 *
 * Everything other than POST /submit falls through to the static SPA assets.
 *
 * Configure once per environment:
 *   wrangler secret put RECRUITING_INTAKE_SECRET
 *   RECRUITING_INTAKE_URL is a plain var in wrangler.jsonc (not a secret).
 */

interface Env {
  ASSETS: Fetcher;
  RECRUITING_INTAKE_URL?: string;
  RECRUITING_INTAKE_SECRET?: string;
}

const SUBMIT_PATH = "/submit";

// Mirror of MAX_INTAKE_BYTES in the recruiting API. Rejecting here saves a
// pointless cross-origin hop for a body the far end will refuse anyway.
const MAX_BODY_BYTES = 12 * 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== SUBMIT_PATH) {
      return env.ASSETS.fetch(request);
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    const upstream = (env.RECRUITING_INTAKE_URL || "").trim();
    const secret = (env.RECRUITING_INTAKE_SECRET || "").trim();
    if (!upstream || !secret) {
      // Misconfiguration, not a submitter error — say so plainly rather than
      // letting the wizard report a generic failure the submitter can't act on.
      console.error("submit relay: RECRUITING_INTAKE_URL / RECRUITING_INTAKE_SECRET not configured");
      return json(
        { ok: false, error: "relay_not_configured", message: "Submission is temporarily unavailable. Please contact TalentCorps." },
        503,
      );
    }

    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return json({ ok: false, error: "payload_too_large" }, 413);
    }

    let response: Response;
    try {
      response = await fetch(upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Home-Proxy-Secret": secret,
        },
        body,
      });
    } catch (err) {
      console.error("submit relay: upstream unreachable", err);
      return json(
        { ok: false, error: "upstream_unreachable", message: "Could not reach the job order system. Please try again." },
        502,
      );
    }

    // Pass the upstream verdict through unchanged. The wizard's api.ts reads
    // both the HTTP status and an `ok:false` in the body, so a failure must not
    // be laundered into a 200 — the submitter has to know their order did not
    // land.
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  },
} satisfies ExportedHandler<Env>;
