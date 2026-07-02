import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYMONGO_SECRET_KEY = Deno.env.get("PAYMONGO_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// TODO: palitan mo ito ng totoong presyo mo sa pesos (in centavos, so 200.00 = 20000)
const VIP_PRICES: Record<string, { amount: number; label: string }> = {
  monthly: { amount: 20000, label: "VIP Monthly" },   // ₱200.00
  yearly: { amount: 69900, label: "VIP Yearly" },      // ₱699.00
  lifetime: { amount: 499900, label: "VIP Lifetime" }, // ₱4,999.00
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const plan = body.plan as string;
    const priceInfo = VIP_PRICES[plan];

    if (!priceInfo) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // reference_number encodes user_id + plan, ito babasahin ng webhook later
    const referenceNumber = `${user.id}|${plan}`;

    const checkoutPayload = {
      data: {
        attributes: {
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          description: "SMMT VIP Membership",
          reference_number: referenceNumber,
          line_items: [
            {
              currency: "PHP",
              amount: priceInfo.amount,
              description: priceInfo.label,
              name: priceInfo.label,
              quantity: 1,
            },
          ],
          payment_method_types: ["gcash", "card", "paymaya", "grab_pay"],
          success_url: body.success_url || "https://example.com/vip-success",
          cancel_url: body.cancel_url || "https://example.com/vip-cancel",
        },
      },
    };

    const pmRes = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(PAYMONGO_SECRET_KEY + ":"),
      },
      body: JSON.stringify(checkoutPayload),
    });

    const pmData = await pmRes.json();

    if (!pmRes.ok) {
      return new Response(JSON.stringify({ error: pmData }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // i-save agad reference habang naghihintay ng payment
    await supabase
      .from("profiles")
      .update({ payment_status: "pending", payment_reference: referenceNumber, plan })
      .eq("id", user.id);

    return new Response(
      JSON.stringify({ checkout_url: pmData.data.attributes.checkout_url }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
