/**
 * Mastra Client - Reproduces the bug
 *
 * This will trigger the bug because:
 * 1. MastraClient makes HTTP request to server
 * 2. Zod schema gets serialized to JSON (loses type info)
 * 3. Server receives plain object, not Zod schema
 * 4. Conversion to JSON Schema lacks .strict()
 * 5. OpenAI rejects due to missing additionalProperties: false
 */

import { MastraClient } from "@mastra/core";
import { z } from "zod";

const client = new MastraClient({
  baseUrl: "http://localhost:3000",
});

async function main() {
  console.log("Reproducing mastra-ai/mastra#12284\n");
  console.log("Calling orchestrator.network() via MastraClient (HTTP)...");
  console.log("This triggers serialization and should reproduce the bug!\n");

  try {
    const response = await client.agent("orchestrator").network(
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

    console.log("✅ Initial call succeeded!");
    console.log("Consuming stream...\n");

    let finalResult: any = null;

    for await (const chunk of response) {
      if (chunk.type === "network-object-result") {
        finalResult = chunk.payload;
      } else if ((chunk as any).object) {
        finalResult = (chunk as any).object;
      }
    }

    if (finalResult) {
      console.log("📊 Final structured output:");
      console.log(JSON.stringify(finalResult, null, 2));
      console.log("\n⚠️  Bug was NOT triggered - the call succeeded!");
      console.log("This means the bug has been fixed in @mastra/core@1.2.0");
    } else {
      console.log("⚠️  No structured output found");
    }
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
      console.log("🐛 This error confirms mastra-ai/mastra#12284!");
      console.log(
        "The bug occurs because MastraClient serializes Zod schemas to JSON,",
      );
      console.log(
        "losing type information. When the server converts to JSON Schema,",
      );
      console.log(
        "it doesn't add additionalProperties: false, which OpenAI requires.",
      );
      console.log("\nThe error occurred in the internal .network() schemas:");
      console.log(
        "  - Routing schema (primitiveId, primitiveType, prompt, selectionReason)",
      );
      console.log(
        "  - Completion check schema (isComplete, completionReason, finalResult?)",
      );
    } else {
      console.log(
        "\n❌ Different error occurred - may not be related to schema validation.",
      );
    }
  }
}

main().catch(console.error);
