import { AgentClient } from 'agents/client';

// Connects the browser to one Chat room. State updates are pushed to onState.
export function connectChat(host, room, onState) {
  return new AgentClient({
    agent: 'Chat',
    name: room,
    host,
    onStateUpdate: (state) => onState(state),
  });
}

export function summarize(client, text) {
  return client.call('summarize', [text]);
}

export function translate(client, text, language) {
  return client.call('translate', [text, language]);
}
