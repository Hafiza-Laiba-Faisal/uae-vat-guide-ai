/**
 * Weekly FTA refresh endpoint. Called by pg_cron with apikey header.
 * Authenticates by checking the apikey header matches the project's
 * publishable key — Lovable's standard cron auth pattern.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/refresh-fta")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const sent = request.headers.get("apikey");
        if (!expected || sent !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { refreshFtaFromFirecrawl } = await import("@/lib/fta-updater.server");
        const result = await refreshFtaFromFirecrawl();

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
