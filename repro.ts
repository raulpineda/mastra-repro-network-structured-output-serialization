/**
 * Minimal reproduction for mastra-ai/mastra#12284
 * https://github.com/mastra-ai/mastra/issues/12284
 *
 * Bug: `.network()` with OpenAI models fails because Mastra's internal routing
 * and completion check schemas use plain `z.object()` without `.strict()`.
 * OpenAI requires `additionalProperties: false` on all objects in strict mode.
 *
 * Errors observed:
 *
 *   "Invalid schema for response_format 'response': In context=(),
 *    'additionalProperties' is required to be supplied and to be false."
 *
 *   "Invalid schema for response_format 'response': In context=(),
 *    'required' is required to be supplied and to be an array including
 *    every key in properties. Missing 'finalResult'."
 *
 * Internal schemas that cause this:
 *
 *   1. Routing schema (selects which sub-agent to call):
 *      z.object({
 *        primitiveId: z.string(),
 *        primitiveType: z.enum(["agent"]),
 *        prompt: z.string(),
 *        selectionReason: z.string(),
 *      })
 *
 *   2. Completion check schema (decides if task is done):
 *      z.object({
 *        isComplete: z.boolean(),
 *        completionReason: z.string(),
 *        finalResult: z.string().optional(),  // <-- not in `required` array
 *      })
 *
 * Workaround: Use Anthropic models for the routing agent. Anthropic does not
 * enforce `additionalProperties` or require all properties in `required`.
 * Sub-agents can still use OpenAI.
 *
 */

import "dotenv/config";
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
    return Promise.resolve({
      results: [
        `Result 1 for "${query}"`,
        `Result 2 for "${query}"`,
        `Result 3 for "${query}"`,
      ],
    });
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

// Debug: Intercept fetch to log ALL OpenAI requests and their schemas
const originalFetch = globalThis.fetch;
let requestCount = 0;
globalThis.fetch = async (input, init) => {
  if (typeof input === "string" && input.includes("openai.com") && init?.body) {
    try {
      requestCount++;
      const body = JSON.parse(init.body as string);

      // Log any request with response_format
      if (body.response_format) {
        console.log(`\n=== OpenAI Request #${requestCount} ===`);
        console.log("URL:", input);
        console.log("Response Format:", JSON.stringify(body.response_format, null, 2));

        // Check for schema in different possible locations
        if (body.response_format.json_schema) {
          console.log("JSON Schema found:");
          console.log(JSON.stringify(body.response_format.json_schema.schema, null, 2));
        }
        console.log("=== End Request ===\n");
      }
    } catch (e) {
      console.log("Failed to parse fetch body:", e);
    }
  }
  return originalFetch(input, init);
};

async function main() {
  console.log("Reproducing mastra-ai/mastra#12284\n");
  console.log("Calling orchestrator.network() with OpenAI gpt-4o...");
  console.log(
    "Provider:",
    (orchestrator as any).llm?.provider || "unknown (check model config)",
  );
  console.log();

  try {
    const response = await orchestrator.network(
      [
        {
          role: "user",
          content: "Search for 'population of Tokyo'",
        },
        {
          role: "assistant",
          content: "I'll search for that information.",
        },
        {
          role: "user",
          content: "Now search for 'population of London'",
        },
        {
          role: "assistant",
          content: "I'll search for that as well.",
        },
        {
          role: "user",
          content:
            "Now calculate the sum of the two populations you found and give me all the results.",
        },
      ],
      {
        structuredOutput: {
          schema: z.object({
            tokyoPopulation: z.string().describe("Population of Tokyo"),
            londonPopulation: z.string().describe("Population of London"),
            totalPopulation: z.number().describe("Sum of both populations"),
          }),
        },
      },
    );

    // If we get here, the bug may have been fixed
    console.log("✅ Initial call succeeded!");
    console.log(
      "\nConsuming stream to see routing steps and completion checks...\n",
    );

    let stepCount = 0;
    let finalResult: any = null;
    const eventTypes = new Set<string>();

    // Consume the stream to get the final result
    for await (const chunk of response) {
      eventTypes.add(chunk.type);

      if (chunk.type === "routing-agent-start") {
        stepCount++;
        console.log(`[Step ${stepCount}] Routing decision...`);
      } else if (chunk.type === "agent-execution-start") {
        console.log(`  → Executing sub-agent`);
      } else if (
        chunk.type.includes("object") ||
        chunk.type.includes("result")
      ) {
        console.log(`  → Event: ${chunk.type}`);
        // Capture any result-like event
        const anyChunk = chunk as any;
        if (anyChunk.payload) {
          finalResult = anyChunk.payload;
        } else if (anyChunk.object) {
          finalResult = anyChunk.object;
        }
      }
    }

    console.log(
      "\nAll event types seen:",
      Array.from(eventTypes).sort().join(", "),
    );

    if (finalResult) {
      console.log("\n📊 Final structured output:");
      console.log(JSON.stringify(finalResult, null, 2));
    } else {
      console.log("\n⚠️  No structured output found");
    }

    console.log("\n✅ SUCCESS - Bug appears to be fixed or not triggered!");
    console.log(`Completed ${stepCount} routing steps with OpenAI models.`);
    console.log(
      "All complex nested schemas in tools and structured output validated successfully.",
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("\n❌ ERROR REPRODUCED:");
    console.error(message);

    // Check if this is the specific schema validation error
    if (
      message.includes("additionalProperties") ||
      message.includes("required") ||
      message.includes("Invalid schema")
    ) {
      console.log("\n---");
      console.log("🐛 This error is caused by mastra-ai/mastra#12284.");
      console.log(
        "Mastra's internal .network() schemas use plain z.object() without .strict(),",
      );
      console.log(
        "but OpenAI requires additionalProperties: false on all JSON schema objects.",
      );
      console.log("\nInternal schemas affected:");
      console.log(
        "  1. Routing schema (primitiveId, primitiveType, prompt, selectionReason)",
      );
      console.log(
        "  2. Completion check schema (isComplete, completionReason, finalResult?)",
      );
      console.log(
        "\nWorkaround: Use Anthropic models for the routing agent instead of OpenAI.",
      );
    } else {
      console.log(
        "\n❌ Different error occurred - may not be related to schema validation.",
      );
    }
  }
}

main();
