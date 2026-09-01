import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const logs: string[] = [];
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ step: "auth", error: "No auth header" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    logs.push("env vars ok");

    // Step 1: Verify user
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ step: "getUser", error: authErr?.message }, 401);
    logs.push(`user ok: ${user.email}`);

    // Step 2: Check role
    const { data: profile, error: profErr } = await userClient
      .from("profiles").select("role, active").eq("id", user.id).single();
    logs.push(`profile: ${JSON.stringify(profile)}, err: ${profErr?.message}`);
    if (!profile || profile.role !== "OWNER") return json({ step: "role", profile }, 403);

    // Step 3: Create auth user via admin
    const admin = createClient(url, serviceKey);
    const testEmail = `test-cashier-${Date.now()}@test.com`;

    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: "TestPass123!",
      email_confirm: true,
      user_metadata: { full_name: "Test Cashier", role: "CASHIER" },
    });

    if (createErr) return json({ step: "createUser", error: createErr.message }, 500);
    logs.push(`auth user created: ${newUser?.user?.id}`);

    // Step 4: Upsert profile
    const { error: upsertErr } = await admin.from("profiles").upsert({
      id: newUser!.user!.id,
      full_name: "Test Cashier",
      email: testEmail,
      role: "CASHIER",
      active: true,
      must_change_password: true,
    }, { onConflict: "id" });

    if (upsertErr) {
      logs.push(`upsert error: ${upsertErr.message}`);
      // Cleanup
      await admin.auth.admin.deleteUser(newUser!.user!.id);
      return json({ step: "upsert", error: upsertErr.message, logs }, 500);
    }
    logs.push("profile upserted");

    // Step 5: Cleanup (delete the test user)
    await admin.auth.admin.deleteUser(newUser!.user!.id);
    logs.push("cleanup done");

    return json({ ok: true, logs }, 200);
  } catch (err: any) {
    logs.push(`exception: ${err.message}`);
    return json({ step: "exception", error: err.message, logs }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
