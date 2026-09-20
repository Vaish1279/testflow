import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  try {
    const { email, full_name } = await req.json();
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("WELCOME_FROM_EMAIL");
    if (!apiKey || !from || !email) {
      return new Response(JSON.stringify({ ok: false, skipped: true }), { headers: { "Content-Type": "application/json" } });
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Your TestFlow account was created successfully",
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Congratulations!</h2><p>${full_name ? `Hello ${String(full_name).replace(/[<>]/g, "")},` : "Hello,"}</p><p>Your TestFlow account has been created successfully.</p><p>You can now log in and start using your TestFlow workspace.</p><p>— TestFlow</p></div>`
      })
    });
    const body = await response.text();
    return new Response(body, { status: response.status, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
