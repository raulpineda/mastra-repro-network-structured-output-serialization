/**
 * Mastra Server - Exposes agents via HTTP
 *
 * This is where the bug occurs: when clients call .network() through HTTP,
 * the Zod schemas get serialized and lose their type information.
 */

import "dotenv/config";
import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { MockMemory } from "@mastra/core/memory";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Create memory for the agent network
const memory = new MockMemory();

// Simple tools using Mastra's createTool
const calculateTool = createTool({
  id: "calculate",
  description: "Performs basic mathematical calculations",
  inputSchema: z.object({
    expression: z.string().describe("Mathematical expression to evaluate"),
  }),
  execute: async (inputData) => {
    const { expression } = inputData;
    const result = eval(expression);
    return { result };
  },
});

const searchTool = createTool({
  id: "search",
  description: "Searches for information",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async (inputData) => {
    const { query } = inputData;
    return {
      results: [
        `Result 1 for "${query}"`,
        `Result 2 for "${query}"`,
        `Result 3 for "${query}"`,
      ],
    };
  },
});

// Research agent with search tool
const researchAgent = new Agent({
  name: "Research Agent",
  description: "Searches for information and provides research findings.",
  instructions:
    "You are a research specialist. Use the search tool to find information.",
  model: "openai/gpt-4o-mini",
  tools: {
    search: searchTool,
  },
});

// Math agent with calculation tool
const mathAgent = new Agent({
  name: "Math Agent",
  description: "Solves mathematical problems and performs calculations.",
  instructions:
    "You are a mathematics expert. Use the calculate tool to solve math problems.",
  model: "openai/gpt-4o-mini",
  tools: {
    calculate: calculateTool,
  },
});

// Routing agent that uses .network() with specialized sub-agents
const orchestrator = new Agent({
  name: "Orchestrator",
  description: "Routes requests to specialized sub-agents.",
  instructions:
    "You coordinate specialized sub-agents to answer questions. " +
    "Delegate to the research agent for information lookups and the math agent for calculations.",
  model: "openai/gpt-4o", // <-- model used for internal routing/completion schemas
  memory, // <-- memory required for .network()
  agents: {
    researchAgent,
    mathAgent,
  },
});

// Create Mastra instance with agents
const mastra = new Mastra({
  agents: {
    orchestrator,
    researchAgent,
    mathAgent,
  },
});

const PORT = process.env.PORT || 3000;

console.log(`Starting Mastra server on port ${PORT}...`);
console.log("Available agents: orchestrator, researchAgent, mathAgent");
console.log();

// Start the server
mastra.serve({ port: PORT as number });

console.log(`✅ Mastra server running at http://localhost:${PORT}`);
console.log("Ready to receive .network() calls from MastraClient");
