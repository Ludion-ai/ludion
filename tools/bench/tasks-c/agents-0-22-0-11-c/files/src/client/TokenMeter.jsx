import { useEffect, useRef, useState } from 'react';

// Shows tokens per second for the reply that is streaming. It counts how often the last message grows,
// so it is only accurate when the parent re-renders on every streamed chunk.
export function TokenMeter({ messages, streaming }) {
  const start = useRef(0);
  const chunks = useRef(0);
  const [rate, setRate] = useState(0);
  const last = messages.at(-1);
  const length = last ? JSON.stringify(last.parts).length : 0;

  useEffect(() => {
    if (!streaming) {
      start.current = 0;
      chunks.current = 0;
      return;
    }
    if (!start.current) start.current = performance.now();
    chunks.current += 1;
    setRate(chunks.current / ((performance.now() - start.current) / 1000 || 1));
  }, [length, streaming]);

  return <p className="meter">{streaming ? `${rate.toFixed(1)} tokens/s` : ''}</p>;
}
