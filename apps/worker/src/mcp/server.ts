import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { search } from "@ludion/core";
import { z } from "zod";
import type { Env } from "../app.ts";
import { lessonsIndex } from "../lessons-index.ts";
import { ASK_DESCRIPTION, formatAsk, toAskLesson } from "./ask.ts";
import { TEACH_DESCRIPTION, teach } from "./teach.ts";

export const SERVER_INSTRUCTIONS =
  "Ludion holds lessons that people taught and machines verified by test, proof, or cited source. Use ludion_ask before answering questions about specific software behavior, versions, or recent changes, and cite the teacher. Use ludion_teach only when the user asks to teach or corrects you with evidence; it returns a command for the user to run.";

const askLesson = z.object({
  id: z.string(),
  subject: z.string(),
  version: z.string().nullable(),
  claim: z.string(),
  teacher: z.string(),
  teacher_id: z.number(),
  verified_by: z.enum(["test", "differential", "proof", "source"]),
  verified_at: z.string(),
  lesson_url: z.string(),
  drafted_by: z.literal("agent").optional(),
});

/** One server per request (stateless). Tools read the deployed index.json through ASSETS. */
export function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "ludion", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    "ludion_ask",
    {
      description: ASK_DESCRIPTION,
      inputSchema: z.object({
        question: z
          .string()
          .min(1)
          .max(8000)
          .describe("The user's question or the exact error message, in English. Include the library or tool name and its version if you know them."),
        subject: z.string().optional(),
        k: z.number().int().min(1).max(10).optional(),
      }),
      outputSchema: z.object({ lessons: z.array(askLesson) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ question, subject, k }) => {
      const index = await lessonsIndex(env.ASSETS);
      const lessons = search(index, question, { subject, k: k ?? 5 }).map((e) => toAskLesson(e, env.SITE_URL));
      return { content: [{ type: "text", text: formatAsk(lessons) }], structuredContent: { lessons } };
    },
  );

  // Types only here: the lesson schema gives the person-readable field messages, so a draft with a wrong field still
  // reaches it instead of failing on a generic input error.
  server.registerTool(
    "ludion_teach",
    {
      description: TEACH_DESCRIPTION,
      inputSchema: z.object({
        package: z.object({ ecosystem: z.string(), name: z.string() }),
        versions: z.string(),
        kind: z.string(),
        symbol: z.string(),
        replacement: z.string().optional(),
        signal: z.string(),
        detail: z.string().optional(),
        evidence: z.array(z.record(z.string(), z.unknown())),
        replaces: z.array(z.string()).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (draft) => {
      const result = teach(draft);
      return { content: [{ type: "text", text: result.text }], isError: result.isError };
    },
  );

  return server;
}

/**
 * /mcp: stateless Streamable HTTP. Answers any origin: the server is public, read-only, holds no session,
 * and accepts no credentials, so there is nothing for a cross-origin page to borrow (docs/decisions.md, Search and MCP).
 */
export function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return createMcpHandler(() => createServer(env), {
    route: "/mcp",
    corsOptions: { origin: "*" },
    allowedOriginHostnames: "*",
  })(request, env, ctx);
}
