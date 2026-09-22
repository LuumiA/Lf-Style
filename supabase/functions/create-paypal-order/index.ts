import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPaypalAccessToken } from "../_shared/paypal.ts";

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

    const totalValue = orderItems
      .reduce(
        (sum, item) => sum + Number(item.unit_price) * item.quantity,
        0,
      )
      .toFixed(2);

    const { accessToken, apiBase } = await getPaypalAccessToken();
    const paypalResponse = await fetch(`${apiBase}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: orderId,
            amount: {
              currency_code: "EUR",
              value: totalValue,
              breakdown: {
                item_total: { currency_code: "EUR", value: totalValue },
              },
            },
            items: orderItems.map((item) => ({
              name: item.product_name.slice(0, 127),
              unit_amount: {
                currency_code: "EUR",
                value: Number(item.unit_price).toFixed(2),
              },
              quantity: String(item.quantity),
            })),
          },
        ],
        application_context: {
          brand_name: "LF-Style",
          shipping_preference: "GET_FROM_FILE",
          user_action: "PAY_NOW",
          return_url: `${siteUrl}/?paypal=return&order_id=${orderId}`,
          cancel_url: `${siteUrl}/?payment=cancelled`,
        },
      }),
    });
    const paypalOrder = await paypalResponse.json();
    const approveLink = paypalOrder.links?.find(
      (link: { rel: string }) => link.rel === "approve",
    )?.href;
    if (!paypalResponse.ok || !approveLink) {
      await userClient.rpc("cancel_order", { target_order_id: orderId });
      return json({ error: "PAYPAL_ORDER_FAILED" }, 502);
    }

    await adminClient
      .from("orders")
      .update({ paypal_order_id: paypalOrder.id })
      .eq("id", orderId);
    return json({ url: approveLink, orderId });
  } catch {
    return json({ error: "CHECKOUT_FAILED" }, 500);
  }
});
