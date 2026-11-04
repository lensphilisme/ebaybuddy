import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/ebay/notifications")({ server: { handlers: {
  GET: async ({ request }) => {
    const code = new URL(request.url).searchParams.get("challenge_code");
    if (!code || code.length > 500) return Response.json({ error: "Invalid challenge" }, { status: 400 });
    const token = process.env.EBAY_VERIFICATION_TOKEN;
    if (!token) return Response.json({ error: "Notifications are not configured" }, { status: 503 });
    const { challengeResponse, notificationEndpoint } = await import("@/lib/ebay/notification-verification.server");
    return Response.json({ challengeResponse: challengeResponse(code, token, notificationEndpoint) });
  },
  POST: async ({ request }) => {
    const header = request.headers.get("x-ebay-signature");
    if (!header || header.length > 4000) return new Response(null, { status: 401 });
    if (Number(request.headers.get("content-length") || 0) > 1_000_000) return new Response(null, { status: 413 });
    const body = await request.text();
    if (body.length > 1_000_000) return new Response(null, { status: 413 });
    const { authenticateNotification } = await import("@/lib/ebay/notification-verification.server");
    if (!(await authenticateNotification(body, header))) return new Response(null, { status: 401 });
    let envelope;
    try {
      envelope = JSON.parse(body);
      if (typeof envelope.metadata?.topic !== "string" || typeof envelope.notification?.notificationId !== "string" || typeof envelope.notification?.subscriptionId !== "string") return new Response(null, { status: 400 });
    } catch { return new Response(null, { status: 400 }); }
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { handleEbayNotification } = await import("@/lib/ebay/notifications.server");
      await handleEbayNotification(supabaseAdmin, envelope);
      return new Response(null, { status: 204 });
    } catch {
      console.error(JSON.stringify({ svc: "ebay-notification", error: "processing_failed" }));
      return new Response(null, { status: 503 });
    }
  },
} } });