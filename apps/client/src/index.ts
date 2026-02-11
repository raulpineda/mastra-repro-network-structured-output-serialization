import { MastraClient } from "@mastra/client-js";
import { z } from "zod";

const serverUrl = process.env.MASTRA_SERVER_URL || "http://localhost:4111";
const client = new MastraClient({ baseUrl: serverUrl });

async function main() {
  console.log("Reproducing mastra-ai/mastra#12284");
  console.log(`Connecting to: ${serverUrl}\n`);

  try {
    const response = await client.getAgent("orchestrator").network(
      [{ role: "user", content: "What is 2 + 2?" }],
      {
        structuredOutput: {
          schema: z.object({
            answer: z.number().describe("The answer to the question"),
          }),
        },
      },
    );

    console.log("✅ Request succeeded, processing stream...\n");

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
      console.log("✅ SUCCESS - Bug NOT reproduced");
      console.log("Final output:", JSON.stringify(finalResult, null, 2));
    } else {
      console.log("⚠️  No structured output received");
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    console.error("\n❌ ERROR REPRODUCED!");
    console.error("Error:", message);

    if (
      message.includes("additionalProperties") ||
      message.includes("Invalid schema")
    ) {
      console.log("\n🐛 Bug confirmed: mastra-ai/mastra#12284");
      console.log("Issue: Internal schemas missing additionalProperties: false");
    }

    process.exit(1);
  }
}

main().catch(console.error);
