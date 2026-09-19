export const getPaypalAccessToken = async () => {
  const clientId = Deno.env.get("PAYPAL_CLIENT_ID")!;
  const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET")!;
  const apiBase =
    Deno.env.get("PAYPAL_API_BASE") ?? "https://api-m.sandbox.paypal.com";

  const response = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error("PAYPAL_AUTH_FAILED");
  }
  return { accessToken: data.access_token as string, apiBase };
};
