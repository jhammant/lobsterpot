import { LobsterPotDaemonConfig, PotStatus, WebhookClient, WebhookEventType } from './daemon-types.js';

export class HttpWebhookClient implements WebhookClient {
  constructor(private readonly config: LobsterPotDaemonConfig) {}

  async send(event: WebhookEventType, pot: PotStatus, details: Record<string, unknown>): Promise<void> {
    const url = this.config.webhook.url;
    const enabledEvents = this.config.webhook.enabledEvents ?? [];
    if (!url || !enabledEvents.includes(event)) return;

    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.config.webhook.headers,
      },
      body: JSON.stringify({
        event,
        pot,
        details,
      }),
    });
  }
}
