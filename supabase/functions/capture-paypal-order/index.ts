import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPaypalAccessToken } from "../_shared/paypal.ts";
import { sendOrderConfirmationEmail } from "../_shared/email.ts";

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
    const paypalOrderId = String(body.paypal_order_id ?? "");
    if (!paypalOrderId) return json({ error: "MISSING_ORDER_ID" }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: order } = await adminClient
      .from("orders")
      .select("id, user_id, status, total")
      .eq("paypal_order_id", paypalOrderId)
      .maybeSingle();
    if (!order || order.user_id !== userData.user.id)
      return json({ error: "ORDER_NOT_FOUND" }, 404);
    if (order.status === "paid") return json({ status: "COMPLETED" });
    if (order.status !== "pending")
      return json({ error: "ORDER_NOT_PAYABLE" }, 409);

    const { accessToken, apiBase } = await getPaypalAccessToken();
    const captureResponse = await fetch(
      `${apiBase}/v2/checkout/orders/${paypalOrderId}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );
    const captureResult = await captureResponse.json();
    if (!captureResponse.ok || captureResult.status !== "COMPLETED") {
      return json({ error: "PAYPAL_CAPTURE_FAILED" }, 502);
    }

    const shippingInfo = captureResult.purchase_units?.[0]?.shipping;
    const shipping = shippingInfo
      ? {
          name: shippingInfo.name?.full_name ?? null,
          line1: shippingInfo.address?.address_line_1 ?? null,
          line2: shippingInfo.address?.address_line_2 ?? null,
          city: shippingInfo.address?.admin_area_2 ?? null,
          postalCode: shippingInfo.address?.postal_code ?? null,
          country: shippingInfo.address?.country_code ?? null,
          phone: null,
        }
      : null;

    const { error: updateError } = await adminClient
      .from("orders")
      .update({ status: "paid", shipping })
      .eq("id", order.id);
    if (updateError) {
      console.error("ORDER_STATUS_UPDATE_FAILED", updateError);
      return json({ error: "ORDER_STATUS_UPDATE_FAILED" }, 500);
    }

    if (userData.user.email) {
      const { data: orderItems } = await adminClient
        .from("order_items")
        .select("product_name, unit_price, quantity")
        .eq("order_id", order.id);
      await sendOrderConfirmationEmail({
        to: userData.user.email,
        orderId: order.id,
        total: Number(order.total),
        items: (orderItems ?? []).map((item) => ({
          name: item.product_name,
          quantity: item.quantity,
          unitPrice: Number(item.unit_price),
        })),
      });
    }

    return json({ status: "COMPLETED" });
  } catch {
    return json({ error: "CAPTURE_FAILED" }, 500);
  }
});
