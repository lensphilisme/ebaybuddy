import { createHash, createVerify } from "node:crypto";
import { EbayRestClient } from "./rest.server";
import { getEbayApplicationToken } from "./auth.server";

export const notificationEndpoint = "https://ebaybuddy.lovable.app/api/public/ebay/notifications";

export function challengeResponse(code: string, token: string, endpoint: string) {
  return createHash("sha256").update(code).update(token).update(endpoint).digest("hex");
}

export function verifyNotificationSignature(body: string, header: string, key: string, digest = "SHA1"): boolean {
  try {
    const signature = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { kid?: string; signature?: string };
    if (!signature.signature) return false;
    if (!["SHA1", "SHA256"].includes(digest.toUpperCase())) return false;
    const verifier = createVerify(digest.toLowerCase());
    // Matches eBay's official event-notification SDK's canonical JSON serialization.
    verifier.update(JSON.stringify(JSON.parse(body)));
    return verifier.verify(key, signature.signature, "base64");
  } catch { return false; }
}

export async function authenticateNotification(body: string, header: string): Promise<boolean> {
  try {
    const signature = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { kid?: string };
    if (!signature.kid || !/^[A-Za-z0-9_-]{1,200}$/.test(signature.kid)) return false;
    const client = new EbayRestClient(await getEbayApplicationToken());
    const key = await client.json<{ key: string; digest: string }>(`/commerce/notification/v1/public_key/${encodeURIComponent(signature.kid)}`);
    return verifyNotificationSignature(body, header, key.key, key.digest);
  } catch { return false; }
}