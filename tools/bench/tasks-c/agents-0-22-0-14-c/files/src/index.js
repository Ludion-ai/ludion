import { Agent, routeAgentRequest } from 'agents';

export { ToolGateway } from './gateway.js';

export class Chat extends Agent {
  async onMessage(connection, message) {
    connection.send(`echo: ${message}`);
  }
}

export default {
  async fetch(request, env) {
    return (await routeAgentRequest(request, env)) ?? new Response('Not found', { status: 404 });
  },
};
