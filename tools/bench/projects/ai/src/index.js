import { generateText } from "ai";

export async function summarize(model, text) {
  const { text: summary } = await generateText({ model, prompt: `Summarize: ${text}` });
  return summary;
}
