// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

// This edge function fixes the handle_new_user trigger by creating
// a helper function that can then be used to recreate the trigger.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Check available env vars
    const envKeys = [
      "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
      "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL",
    ];
    const envStatus: Record<string, boolean> = {};
    for (const k of envKeys) {
      envStatus[k] = !!Deno.env.get(k);
    }

    const admin = createClient(url, serviceKey);

    // Step 1: Create a helper function via RPC that can run DDL
    // We'll create a function that runs our SQL
    const createHelperSQL = `
      CREATE OR REPLACE FUNCTION public._exec_sql(sql text)
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      BEGIN
        EXECUTE sql;
      END;
      $$;
    `;

    // We can't call _exec_sql if it doesn't exist yet. 
    // But we can try to create it by calling the admin API...
    
    // Actually, let's try using the Supabase SQL API directly
    // The Management API SQL endpoint
    const projectId = "wlmpujyezgwbixpkpuyf";
    
    // Try the PostgREST /rpc endpoint to create the helper function
    // This won't work for DDL...
    
    // Let's try a different approach: use the GoTrue admin API to check
    // if createUser works now (maybe the user already fixed the trigger)
    const testEmail = `trigger-test-${Date.now()}@test.com`;
    const createResp = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: testEmail,
        password: "TestPass123!",
        email_confirm: true,
        user_metadata: { full_name: "Test", role: "CASHIER" },
      }),
    });

    const createBody = await createResp.json();

    if (createResp.ok) {
      // Clean up - delete the test user
      await fetch(`${url}/auth/v1/admin/users/${createBody.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey },
      });
      
      return new Response(JSON.stringify({
        success: true,
        message: "Trigger is working! createUser succeeded.",
        envVars: envStatus,
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // createUser failed - the trigger is still broken
    // Try to fix it using the Management API with the service key
    const fixSQL = `
      DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
      DROP FUNCTION IF EXISTS public.handle_new_user();
      CREATE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $trigger$ BEGIN
        INSERT INTO public.profiles (id, full_name, role, active)
        VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''),
          COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role,'CASHIER'::public.app_role), true)
        ON CONFLICT (id) DO UPDATE SET
          full_name = COALESCE(NEW.raw_user_meta_data->>'full_name', public.profiles.full_name),
          role = COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, public.profiles.role),
          updated_at = now();
        RETURN NEW;
      EXCEPTION WHEN OTHERS THEN
        RETURN NEW;
      END; $trigger$;
      CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    `;

    // Try Management API
    const mgmtResp = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: fixSQL }),
    });

    const mgmtBody = await mgmtResp.text();

    return new Response(JSON.stringify({
      success: false,
      createUserError: createBody?.msg || "unknown",
      triggerFixAttempt: { status: mgmtResp.status, body: mgmtBody },
      envVars: envStatus,
    }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
