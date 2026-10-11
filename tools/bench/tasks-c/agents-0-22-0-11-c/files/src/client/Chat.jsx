import { useState } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from 'agents/chat/react';
import { TokenMeter } from './TokenMeter.jsx';

export function Chat({ room }) {
  const agent = useAgent({ agent: 'Chat', name: room });
  const { messages, sendMessage, status } = useAgentChat({ agent });
  const [input, setInput] = useState('');

  return (
    <main>
      <ul>
        {messages.map((m) => (
          <li key={m.id} className={m.role}>
            {m.parts.map((p, i) => (p.type === 'text' ? <span key={i}>{p.text}</span> : null))}
          </li>
        ))}
      </ul>
      <TokenMeter messages={messages} streaming={status === 'streaming'} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage({ text: input });
          setInput('');
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit">Send</button>
      </form>
    </main>
  );
}
