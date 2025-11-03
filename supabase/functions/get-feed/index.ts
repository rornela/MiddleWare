// Supabase Edge Function: get-feed
// Acts as the Middleware Factory using a strategy pattern to select ranking logic.
// - Reads the caller's session from Authorization header
// - Reads user_feed_preferences to choose algorithm
// - Strategies:
//   - custom: call SQL function get_custom_ranked_feed
//   - third_party: fetch from external endpoint (stub)
//   - chronological (default): simple ORDER BY created_at DESC

// Deno standard http server
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// Supabase client for Deno
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

const SUPABASE_URL = Deno.env.get("https://mhbhunserxitboepzysy.supabase.co);
const SUPABASE_ANON_KEY = Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oYmh1bnNlcnhpdGJvZXB6eXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxNjE0NTEsImV4cCI6MjA3NzczNzQ1MX0.TM1kqYYy3ew3M-bTeb2aaVMXTr-g2fMDGcp0EbGAnX8Y");
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing required environment variables for Supabase.");
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    let limit = Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10), 0);
    let offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);
    // Also accept JSON body with { limit, offset }
    try {
      if (req.method !== 'GET') {
        const body = await req.json();
        if (typeof body?.limit === 'number') limit = Math.max(body.limit, 0);
        if (typeof body?.offset === 'number') offset = Math.max(body.offset, 0);
      }
    } catch (_) {
      // ignore body parse errors
    }

    const authHeader = req.headers.get("Authorization") || "";

    // Client bound to the caller's JWT context (for reading the user)
    const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Identify user
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    // Read user preferences
    const { data: prefRow, error: prefErr } = await userClient
      .from("user_feed_preferences")
      .select("preferences")
      .eq("user_id", userId)
      .maybeSingle();

    if (prefErr) {
      console.error("preferences error", prefErr);
    }
    const preferences = (prefRow?.preferences as Record<string, unknown>) ?? {};
    const algorithmId = (preferences["algorithm_id"] as string) ?? "chronological";

    // Strategy implementations
    const strategies: Record<string, () => Promise<Response>> = {
      custom: async () => {
        const { data, error } = await userClient.rpc("get_custom_ranked_feed", {
          requesting_user_id: userId,
          p_limit: limit,
          p_offset: offset,
        });
        if (error) {
          console.error("rpc error", error);
          return json({ error: "ranking_failed", details: error.message }, 500);
        }
        return json({ posts: data ?? [], algorithm: "custom" });
      },
      third_party: async () => {
        const endpoint = (preferences["third_party_endpoint"] as string) ?? "";
        if (!endpoint) {
          return json({ error: "missing_third_party_endpoint" }, 400);
        }
        try {
          const tpUrl = new URL(endpoint);
          tpUrl.searchParams.set("user_id", userId);
          tpUrl.searchParams.set("limit", String(limit));
          tpUrl.searchParams.set("offset", String(offset));
          const resp = await fetch(tpUrl.toString(), {
            headers: { Authorization: authHeader },
          });
          if (!resp.ok) {
            return json({ error: "third_party_failed", status: resp.status }, 502);
          }
          const data = (await resp.json()) as Json;
          return json({ posts: data, algorithm: "third_party" });
        } catch (e) {
          console.error("third_party exception", e);
          return json({ error: "third_party_exception" }, 500);
        }
      },
      chronological: async () => {
        const { data, error } = await userClient
          .from("posts")
          .select(
            "id, author_id, text_content, created_at, media:media(type, mux_playback_id, storage_path)"
          )
          .order("created_at", { ascending: false })
          .range(offset, Math.max(offset + limit - 1, offset));

        if (error) {
          console.error("chronological error", error);
          return json({ error: "chronological_failed", details: error.message }, 500);
        }
        return json({ posts: data ?? [], algorithm: "chronological" });
      },
    };

    const exec = strategies[algorithmId] ?? strategies["chronological"];
    return await exec();
  } catch (e) {
    console.error(e);
    return json({ error: "internal_server_error" }, 500);
  }
});

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}


