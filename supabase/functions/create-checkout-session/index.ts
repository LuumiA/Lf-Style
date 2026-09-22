import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
    const siteUrl = Deno.env.get("SITE_URL")!;
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } =
      await userClient.auth.getUser();
    if (userError || !userData.user)
      return json({ error: "AUTHENTICATION_REQUIRED" }, 401);

    const body = await request.json();
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json({ error: "EMPTY_CART" }, 400);

    const delivery = body.delivery ?? {};
    if (
      !delivery.fullName ||
      !delivery.phone ||
      !delivery.line1 ||
      !delivery.postalCode ||
      !delivery.city
    ) {
      return json({ error: "MISSING_DELIVERY_INFO" }, 400);
    }
    const shipping = {
      name: delivery.fullName,
      line1:
        delivery.method === "relay"
          ? `${delivery.relayName ?? ""} - ${delivery.line1}`.trim()
          : delivery.line1,
      line2: delivery.line2 ?? null,
      city: delivery.city,
      postalCode: delivery.postalCode,
      country: delivery.country ?? null,
      phone: delivery.phone,
    };
    const billing = body.billing ?? null;

    const { data: orderId, error: orderError } = await userClient.rpc(
      "create_order",
      {
        order_items: items.map(
          (item: {
            product_id: string;
            quantity: number;
            size?: string;
            color?: string;
          }) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            size: item.size ?? null,
            color: item.color ?? null,
          }),
        ),
      },
    );
    if (orderError || !orderId)
      return json(
        { error: orderError?.message ?? "ORDER_CREATION_FAILED" },
        400,
      );

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: orderItems } = await adminClient
      .from("order_items")
      .select("product_name, unit_price, quantity")
      .eq("order_id", orderId);
    if (!orderItems?.length)
      return json({ error: "ORDER_ITEMS_NOT_FOUND" }, 400);

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set(
      "success_url",
      `${siteUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    );
    params.set("cancel_url", `${siteUrl}/?payment=cancelled`);
    params.set("customer_email", userData.user.email ?? "");
    params.set("metadata[order_id]", orderId);
    orderItems.forEach((item, index) => {
      params.set(`line_items[${index}][price_data][currency]`, "eur");
      params.set(
        `line_items[${index}][price_data][product_data][name]`,
        item.product_name,
      );
      params.set(
        `line_items[${index}][price_data][unit_amount]`,
        String(Math.round(Number(item.unit_price) * 100)),
      );
      params.set(`line_items[${index}][quantity]`, String(item.quantity));
    });

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    const session = await stripeResponse.json();
    if (!stripeResponse.ok || !session.url) {
      await userClient.rpc("cancel_order", { target_order_id: orderId });
      return json({ error: "STRIPE_SESSION_FAILED" }, 502);
    }

    await adminClient
      .from("orders")
      .update({
        stripe_session_id: session.id,
        shipping,
        delivery_method: delivery.method ?? null,
        billing,
      })
      .eq("id", orderId);
    return json({ url: session.url, orderId });
  } catch {
    return json({ error: "CHECKOUT_FAILED" }, 500);
  }
});
