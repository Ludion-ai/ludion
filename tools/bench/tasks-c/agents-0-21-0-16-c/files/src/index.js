import { Agent, routeAgentRequest } from 'agents';
import { summarize } from './summarize.js';

export class Chat extends Agent {
  async onMessage(connection, message) {
    connection.send(await summarize(this.env, String(message)));
  }
}

export default {
  async fetch(request, env) {
    return (await routeAgentRequest(request, env)) ?? new Response('Not found', { status: 404 });
  },
};
