import { Agent, routeAgentRequest } from 'agents';

// Builds the user's data export and returns its download URL. Slow: it can take a minute for big accounts.
async function buildExport(agentName) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  return `https://exports.example.com/${encodeURIComponent(agentName)}/${Date.now()}.zip`;
}

export class Chat extends Agent {
  async onMessage(connection, message) {
    if (message === 'export') {
      const url = await buildExport(this.name);
      connection.send(`export ready: ${url}`);
      return;
    }
    connection.send(`echo: ${message}`);
  }
}

export default {
  async fetch(request, env) {
    return (await routeAgentRequest(request, env)) ?? new Response('Not found', { status: 404 });
  },
};
