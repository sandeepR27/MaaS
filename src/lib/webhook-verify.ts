import crypto from "crypto";
import { getEnv } from "./env";

/**
 * Verify Recall AI webhook signature using HMAC-SHA256.
 * See: https://docs.recall.ai/docs/authenticating-requests-from-recallai
 */
export function verifyRecallWebhook(
  rawBody: string,
  signature: string | null
): boolean {
  if (!signature) return false;

  const env = getEnv();
  const secret = env.RECALL_WORKSPACE_VERIFICATION_SECRET;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
