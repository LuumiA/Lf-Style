type OrderEmailItem = {
  name: string;
  quantity: number;
  unitPrice: number;
};

export const sendOrderConfirmationEmail = async (params: {
  to: string;
  orderId: string;
  total: number;
  items: OrderEmailItem[];
}) => {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return;

  const from = Deno.env.get("EMAIL_FROM") ?? "LF-Style <onboarding@resend.dev>";
  const itemsHtml = params.items
    .map(
      (item) =>
        `<tr><td style="padding:6px 0">${item.name} × ${item.quantity}</td><td style="padding:6px 0;text-align:right">${(item.unitPrice * item.quantity).toFixed(2)}€</td></tr>`,
    )
    .join("");

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h1 style="font-size:20px">Merci pour votre commande !</h1>
      <p>Commande #${params.orderId.slice(0, 8)} confirmée.</p>
      <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
      <p style="font-weight:bold;margin-top:16px">Total : ${params.total.toFixed(2)}€</p>
      <p style="color:#777;font-size:12px">LF-Style</p>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: "Confirmation de votre commande - LF-Style",
        html,
      }),
    });
    if (!response.ok) {
      console.error("EMAIL_SEND_FAILED", await response.text());
    }
  } catch (error) {
    console.error("EMAIL_SEND_FAILED", error);
  }
};
