/**
 * Minimal Mastra Server - Reproduces HTTP serialization bug
 *
 * This server exposes a single orchestrator agent via HTTP.
 * The bug occurs when .network() is called through the HTTP client.
 */

import "dotenv/config";
import express from "express";
import { Mastra } from "@mastra/core";
import { MastraServer } from "@mastra/express";
import { Agent } from "@mastra/core/agent";
import { MockMemory } from "@mastra/core/memory";

// Memory is required for .network() to work
const memory = new MockMemory();

// Minimal sub-agent - doesn't need tools since bug occurs during routing
const subAgent = new Agent({
  name: "Sub Agent",
  description: "A minimal sub-agent for testing .network()",
  instructions: "You are a helpful assistant.",
  model: "openai/gpt-4o-mini",
});

// Orchestrator with .network() capability
const orchestrator = new Agent({
  name: "Orchestrator",
  description: "Routes requests to sub-agents using .network()",
  instructions: "Delegate tasks to the sub-agent.",
  model: "openai/gpt-4o", // <-- This model is used for internal routing
  memory, // <-- Required for .network()
  agents: {
    subAgent, // <-- At least one sub-agent required for .network()
  },
});

// Create Mastra instance
const mastra = new Mastra({
  agents: {
    orchestrator,
    subAgent,
  },
});

// Create Express app
const app = express();
app.use(express.json());

// Initialize Mastra server with Express adapter
const PORT = process.env.PORT || 4111;

console.log(`Starting minimal Mastra server on port ${PORT}...`);
console.log("Available agents: orchestrator, subAgent");
console.log();

// Create and initialize the Mastra server
const server = new MastraServer({ app, mastra });
await server.init();

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", agents: ["orchestrator", "subAgent"] });
});

// Start listening
app.listen(PORT, () => {
  console.log(`✅ Mastra server running at http://localhost:${PORT}`);
  console.log(`   Ready to receive .network() calls from MastraClient`);
  console.log(`   Bug will occur when orchestrator.network() is called over HTTP`);
});
