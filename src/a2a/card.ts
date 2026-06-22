// A2A agent card (1.12.0, roadmap #7).
//
// Served at /.well-known/agent-card.json. Declares ClarifyPrompt as an
// Agent-to-Agent peer with one skill — compile-prompt-for-platform — that other
// agents (CrewAI, LangGraph, AutoGen, Google ADK, …) can call to get a prompt
// compiled for a specific AI platform.

import type { AgentCard } from "@a2a-js/sdk";

/** The A2A protocol version the bundled @a2a-js/sdk implements. */
export const A2A_PROTOCOL_VERSION = "0.3.0";

/** Path segment for the A2A JSON-RPC endpoint (under the configured base path). */
export const A2A_ENDPOINT = "/a2a";

export function buildAgentCard(baseUrl: string, version: string): AgentCard {
  const endpoint = `${baseUrl}${A2A_ENDPOINT}`;
  return {
    name: "ClarifyPrompt",
    description:
      "Context-aware prompt compiler. Give it a rough prompt (and optionally a target platform/category) and it returns a platform-optimized prompt via the clarify → optimize → critique pipeline, grounded in your workspace signals. Supports 60+ AI platforms.",
    protocolVersion: A2A_PROTOCOL_VERSION,
    version,
    url: endpoint,
    preferredTransport: "JSONRPC",
    provider: {
      organization: "Lumabyte Co.",
      url: "https://github.com/LumabyteCo/clarifyprompt-mcp",
    },
    capabilities: {
      streaming: true,        // we stream per-stage progress as task status updates
      pushNotifications: false,
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "compile-prompt-for-platform",
        name: "Compile a prompt for an AI platform",
        description:
          "Takes a rough prompt and an optional target platform (midjourney, sora, claude, cursor, suno, …) and category, runs the clarify → optimize → critique pipeline, and returns a platform-optimized prompt. Input may be plain text (the prompt) or a JSON object { prompt, platform?, category?, post_critique?, auto_revise?, max_iterations? }. The compiled prompt is returned both as text and as a structured artifact with the full pipeline result.",
        tags: ["prompt-engineering", "prompt-optimization", "mcp", "creative", "code"],
        examples: [
          "Compile 'a dragon flying over a castle at sunset' for midjourney",
          "Optimize this prompt for claude: write a function to parse RFC 3339 timestamps",
          "{ \"prompt\": \"lofi beat for studying\", \"platform\": \"suno\", \"post_critique\": true }",
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
      },
    ],
    additionalInterfaces: [{ url: endpoint, transport: "JSONRPC" }],
  };
}
