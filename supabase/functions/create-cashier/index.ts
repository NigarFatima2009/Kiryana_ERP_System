// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResp({ success: false, message: "Server configuration error" }, 500);
    }

    // ── 1. Authenticate the caller ──────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResp({ success: false, message: "Missing authorization" }, 401);
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return jsonResp({ success: false, message: "Unauthorized" }, 401);
    }

    // ── 2. Verify caller is OWNER ───────────────────────────────
    const { data: profile } = await supabaseUser
      .from("profiles").select("role, active").eq("id", user.id).single();

    if (!profile || profile.role !== "OWNER" || !profile.active) {
      return jsonResp({ success: false, message: "Only the owner can create cashier accounts" }, 403);
    }

    // ── 3. Parse body ───────────────────────────────────────────
    const { fullName, email, temporaryPassword } = await req.json();
    if (!fullName?.trim()) return jsonResp({ success: false, message: "Full name is required" }, 400);
    if (!email?.trim()) return jsonResp({ success: false, message: "Email is required" }, 400);

    const password = temporaryPassword && temporaryPassword.length >= 6
      ? temporaryPassword
      : generatePassword();

    // ── 4. Create auth user via REST API (more reliable) ────────
    const createResp = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "apikey": supabaseServiceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: email.trim(),
        password: password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName.trim(),
          role: "CASHIER"
        }
      }),
    });

    const createData = await createResp.json();

    if (!createResp.ok) {
      console.error("[create-cashier] Auth creation failed:", createResp.status, JSON.stringify(createData));
      return jsonResp({
        success: false,
        message: createData?.msg || createData?.error_description || "Failed to create user",
      }, 500);
    }

    const userId = createData.id;
    if (!userId) {
      console.error("[create-cashier] No user ID in response:", createData);
      return jsonResp({ success: false, message: "Failed to create auth user" }, 500);
    }

    console.log("[create-cashier] Auth user created:", userId);

    // ── 5. Wait a moment for trigger to create profile ───────
    // The handle_new_user trigger should create the profile automatically
    await new Promise(resolve => setTimeout(resolve, 500));

    // ── 6. Update profile with our data ─────────────────────
    const { error: profileErr } = await supabaseUser
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        email: email.trim(),
        role: "CASHIER",
        active: true,
        must_change_password: true,
      })
      .eq("id", userId);

    if (profileErr) {
      console.error("[create-cashier] Profile update failed:", profileErr.message);
      // Don't delete the user - just log the error
      // The profile should have been created by trigger with default values
    }

    console.log("[create-cashier] Profile updated for:", userId);

    // ── 7. Audit log (best-effort) ──────────────────────────
    try {
      await supabaseUser.from("audit_logs").insert({
        user_id: user.id,
        action: "cashier_created",
        entity_type: "profile",
        entity_id: userId,
        new_value: { email: email.trim(), full_name: fullName.trim() },
      });
    } catch (e) {
      console.warn("[create-cashier] Audit log failed (non-fatal):", e);
    }

    return jsonResp({
      success: true,
      message: "Cashier account created successfully",
      user_id: userId,
      email: email.trim(),
      temp_password: password,
    });
  } catch (err: any) {
    console.error("[create-cashier] Unexpected error:", err?.message, err?.stack);
    return jsonResp({ success: false, message: "Internal server error: " + (err?.message || "unknown") }, 500);
  }
});

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let pwd = "";
  for (let i = 0; i < 10; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd + "A1!";
}
