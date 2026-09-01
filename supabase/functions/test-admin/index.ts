import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!url || !key) {
      return new Response(JSON.stringify({ ok: false, error: "Missing env vars" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const admin = createClient(url, key);
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });

    return new Response(JSON.stringify({ 
      ok: true, 
      userCount: data?.users?.length ?? 0,
      error: error?.message ?? null 
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});
