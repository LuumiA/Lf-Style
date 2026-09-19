import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrderConfirmationEmail } from "../_shared/email.ts";

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const verifySignature = async (
  payload: string,
  signature: string,
  secret: string,
) => {
  const timestamp = signature.match(/t=(\d+)/)?.[1];
  const expected = signature.match(/v1=([a-f0-9]+)/)?.[1];
  if (!timestamp || !expected) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${payload}`),
  );
  return hex(signed) === expected;
};

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const payload = await request.text();
  const signature = request.headers.get("Stripe-Signature") ?? "";
  if (
    !(await verifySignature(
      payload,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "",
    ))
  ) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(payload);
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const orderId = event.data.object.metadata?.order_id;
    if (orderId) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { error: updateError } = await supabase
        .from("orders")
        .update({ status: "paid" })
        .eq("id", orderId);
      if (updateError) console.error("ORDER_STATUS_UPDATE_FAILED", updateError);

      const email =
        event.data.object.customer_details?.email ??
        event.data.object.customer_email;
      if (!updateError && email) {
        const { data: order } = await supabase
          .from("orders")
          .select("total")
          .eq("id", orderId)
          .maybeSingle();
        const { data: orderItems } = await supabase
          .from("order_items")
          .select("product_name, unit_price, quantity")
          .eq("order_id", orderId);
        await sendOrderConfirmationEmail({
          to: email,
          orderId,
          total: Number(order?.total ?? 0),
          items: (orderItems ?? []).map((item) => ({
            name: item.product_name,
            quantity: item.quantity,
            unitPrice: Number(item.unit_price),
          })),
        });
      }
    }
  }
  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
