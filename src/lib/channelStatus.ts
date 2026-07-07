import "server-only";
import { getWebhookEndpointInfo, getMessageQuotaInfo, type WebhookEndpointInfo, type MessageQuotaInfo } from "@/lib/line";

export type ChannelLiveStatus = {
  webhook: WebhookEndpointInfo | null;
  quota: MessageQuotaInfo | null;
};

/** Live reads (not cached) of this channel's webhook config and quota straight from LINE — cheap GETs, no side effects. */
export async function getChannelLiveStatus(accessTokenEncrypted: string): Promise<ChannelLiveStatus> {
  const [webhook, quota] = await Promise.all([
    getWebhookEndpointInfo(accessTokenEncrypted).catch(() => null),
    getMessageQuotaInfo(accessTokenEncrypted).catch(() => null),
  ]);
  return { webhook, quota };
}
