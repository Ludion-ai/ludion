import { generateText } from 'ai';
import { createWorkersAI } from 'workers-ai-provider';

export async function summarize(env, text) {
  const workersai = createWorkersAI({ binding: env.AI });
  const { text: summary } = await generateText({
    model: workersai('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
    system: 'Summarize the text in three sentences.',
    prompt: text,
  });
  return summary;
}
