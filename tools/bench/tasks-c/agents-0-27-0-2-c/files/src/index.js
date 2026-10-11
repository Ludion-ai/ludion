import { DurableObject } from 'cloudflare:workers';
import { Lifecycle } from 'agents/lifecycle';
import { ChannelGateway, Channels } from 'agents/experimental/channels';
import { web, WebChannel } from 'agents/experimental/channels/web';
import { AiSdkHarness } from 'agents/harness/ai-sdk';
import { createWorkersAI } from 'workers-ai-provider';

// The support agent. Its sessions are served as conversations over the Web Channel.
export class Support extends DurableObject {
  harness = new AiSdkHarness({
    model: createWorkersAI({ binding: this.env.AI })('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
    system: 'You are the support assistant for Acme. Answer briefly.',
  });

  channels = Channels.forHarness(this.harness, { channels: { web: new WebChannel() } });

  lifecycle = Lifecycle.install(this)
    .use(this.harness)
    .use(this.channels.streams)
    .use(this.channels)
    .use(this.channels.websockets);

  receive(event, origin) {
    return this.channels.receive(event, origin);
  }
}

export default {
  async fetch(request, env) {
    const gateway = new ChannelGateway({
      agent: (route) => env.Support.getByName(route),
      channels: {
        web: web({
          // Local development: everyone is the same participant.
          participant: () => ({ id: 'dev', name: 'Developer' }),
        }),
      },
    });
    return (await gateway.fetch(request)) ?? new Response('Not found', { status: 404 });
  },
};
