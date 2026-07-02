import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
const PAYMONGO_WEBHOOK_SECRET = Deno.env.get("PAYMONGO_WEBHOOK_SECRET")!;

Deno.serve(async (req) => {
  try {
    const rawBody = await req.text();
    const sigHeader = req.headers.get("Paymongo-Signature") || "";

    const parts = Object.fromEntries(
      sigHeader.split(",").map((p) => p.split("=") as [string, string])
    );
    const timestamp = parts["t"];
    const expectedSig = parts["li"] || parts["te"];
    const signedPayload = `${timestamp}.${rawBody}`;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(PAYMONGO_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
    const computedSig = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");

    if (computedSig !== expectedSig) {
      return new Response("Invalid signature", { status: 401 });
    }

    const event = JSON.parse(rawBody);
    const eventType = event?.data?.attributes?.type;

    if (eventType === "checkout_session.payment.paid") {
      const session = event.data.attributes.data;
      const referenceNumber: string = session.attributes.reference_number || "";
      const [userId, plan] = referenceNumber.split("|");

      if (userId) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const now = new Date();
        let vipUntil: string | null = null;
        if (plan === "monthly") vipUntil = new Date(now.setMonth(now.getMonth() + 1)).toISOString();
        if (plan === "yearly") vipUntil = new Date(now.setFullYear(now.getFullYear() + 1)).toISOString();

        await supabase
          .from("profiles")
          .update({
            vip_status: "active",
            vip_until: vipUntil,
            plan: plan,
            payment_status: "paid",
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
