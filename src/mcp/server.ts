/**
 * MCP stdio server: the last mile that lets a coding agent ask for the verdict itself.
 *
 * Two tools only — `nodepact.check` (re-measure one or all anchors and return the verdict with
 * the artifact paths) and `nodepact.list` (the stored steering pairs). The operations are
 * injected by the CLI so this module stays a transport: it owns no store, no CDP and no policy,
 * and it writes to stderr only, because stdout carries the protocol.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export type McpOperations = {
  check(input: { node?: string }): Promise<unknown>;
  list(): Promise<unknown>;
};

function asText(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export async function startMcpServer(operations: McpOperations, version: string): Promise<void> {
  const server = new McpServer({ name: "nodepact", version });

  server.registerTool(
    "nodepact.check",
    {
      title: "Check anchored UI assertions",
      description:
        "Re-render the anchored node in the developer's already-open Chrome over CDP, evaluate its " +
        "assertion and diff its crop against the stored baseline. Returns verdict DONE / NOT_DONE / " +
        "UNSTABLE plus the measured values and the diff artifact paths. The verdict is deterministic: " +
        "no model is involved, so calling it again on unchanged code returns the same answer.",
      inputSchema: {
        node: z
          .string()
          .optional()
          .describe("Anchor id or CSS selector to check; omit to check every stored anchor"),
      },
    },
    async ({ node }) => {
      try {
        return asText(await operations.check(node === undefined ? {} : { node }));
      } catch (error) {
        return {
          content: [{ type: "text", text: `nodepact.check failed: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "nodepact.list",
    {
      title: "List anchored UI assertions",
      description:
        "List the steering pairs stored in this project: the anchored node's selector, the human " +
        "annotation, the assertion and the baseline crop path.",
      inputSchema: {},
    },
    async () => {
      try {
        return asText(await operations.list());
      } catch (error) {
        return {
          content: [{ type: "text", text: `nodepact.list failed: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  await server.connect(new StdioServerTransport());
}
