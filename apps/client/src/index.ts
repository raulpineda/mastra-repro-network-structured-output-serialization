/**
 * Mastra Client - Reproduces the bug via HTTP
 *
 * This will trigger the bug because:
 * 1. MastraClient makes HTTP request to server
 * 2. Zod schema gets serialized to JSON (loses type info)
 * 3. Server receives plain object, not Zod schema
 * 4. Conversion to JSON Schema lacks .strict()
 * 5. OpenAI rejects due to missing additionalProperties: false
 */

import { MastraClient } from "@mastra/client-js";
import { z } from "zod";

const serverUrl = process.env.MASTRA_SERVER_URL || "http://localhost:4111";

console.log(`Connecting to Mastra server at: ${serverUrl}\n`);

const client = new MastraClient({
  baseUrl: serverUrl,
});

async function main() {
  console.log("=".repeat(60));
  console.log("Reproducing mastra-ai/mastra#12284");
  console.log("=".repeat(60));
  console.log();
  console.log("Method: MastraClient → HTTP → Mastra Server");
  console.log("This triggers Zod schema serialization (HTTP boundary)");
  console.log();

  try {
    const response = await client.getAgent("orchestrator").network(
      [
        {
          role: "user",
          content:
            "Search for 'capital of France', then calculate 100 + 200. Give me both results.",
        },
      ],
      {
        structuredOutput: {
          schema: z.object({
            capital: z.string().describe("Capital of France"),
            calculation: z.number().describe("Result of 100 + 200"),
          }),
        },
      },
    );

    console.log("✅ Initial HTTP request succeeded!");
    console.log("Processing stream...\n");

    let finalResult: any = null;

    await response.processDataStream({
      onChunk: async (chunk) => {
        if (chunk.type === "network-object-result") {
          finalResult = chunk.payload;
        } else if ((chunk as any).object) {
          finalResult = (chunk as any).object;
        }
      },
    });

    if (finalResult) {
      console.log("📊 Final structured output:");
      console.log(JSON.stringify(finalResult, null, 2));
      console.log();
      console.log("=".repeat(60));
      console.log("⚠️  Bug was NOT triggered - the call succeeded over HTTP!");
      console.log("=".repeat(60));
      console.log();
      console.log("This means the bug has been FIXED in @mastra/core@1.2.0");
      console.log("Schema serialization over HTTP no longer causes OpenAI");
      console.log("validation errors for internal routing/completion schemas.");
    } else {
      console.log("⚠️  No structured output found in stream");
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error();
    console.error("=".repeat(60));
    console.error("❌ ERROR REPRODUCED!");
    console.error("=".repeat(60));
    console.error();
    console.error("Error message:");
    console.error(message);
    console.error();

    // Check if this is the specific schema validation error
    if (
      message.includes("additionalProperties") ||
      message.includes("required") ||
      message.includes("Invalid schema")
    ) {
      console.log("=".repeat(60));
      console.log("🐛 This error CONFIRMS mastra-ai/mastra#12284!");
      console.log("=".repeat(60));
      console.log();
      console.log("Root Cause:");
      console.log("  1. MastraClient serializes Zod schemas → JSON");
      console.log("  2. Type information (.strict()) is lost");
      console.log("  3. Server receives plain object");
      console.log("  4. JSON Schema conversion lacks additionalProperties: false");
      console.log("  5. OpenAI rejects the schema");
      console.log();
      console.log("Affected Schemas:");
      console.log("  - Routing schema (primitiveId, primitiveType, etc.)");
      console.log("  - Completion check schema (isComplete, completionReason, etc.)");
    } else {
      console.error("=".repeat(60));
      console.error("Different error occurred");
      console.error("=".repeat(60));
      console.error();
      console.error("This error may not be related to schema validation.");
      console.error("Check the error message above for details.");
    }

    process.exit(1);
  }
}

main().catch(console.error);
