# Mastra `.network()` OpenAI Schema Validation Bug

> **Bug Status**: ❌ Reproduced in `@mastra/core@1.2.0`
> **Issue**: [mastra-ai/mastra#12284](https://github.com/mastra-ai/mastra/issues/12284)

A complete reproduction of a critical bug in Mastra's `.network()` functionality when using OpenAI models through the HTTP client interface.

---

## What's the Problem?

When using Mastra's multi-agent `.network()` feature with OpenAI models through `@mastra/client-js` (HTTP client), requests fail with a schema validation error:

```
Invalid schema for response_format 'response':
In context=(), 'additionalProperties' is required to be supplied and to be false.
```

This prevents distributed Mastra deployments from using `.network()` with OpenAI models, significantly limiting the framework's multi-agent capabilities in production environments.

## Why Does This Happen?

The issue arises from an **HTTP serialization boundary** between the Mastra client and server:

```
┌─────────────┐                    ┌──────────────┐
│   Client    │  HTTP Request      │    Server    │
│             │  (JSON payload)    │              │
│ MastraClient├───────────────────▶│ Mastra HTTP  │
│             │                    │   Server     │
│             │  Zod schemas lose  │              │
│             │  .strict() info!   │ Converts to  │
│             │                    │ JSON Schema  │
│             │                    │ ❌ Missing   │
│             │                    │ additional-  │
│             │◀───────────────────┤ Properties   │
│             │  400 Error from    │              │
│             │  OpenAI API        │              │
└─────────────┘                    └──────────────┘
```

### The Technical Details

1. **Mastra's internal schemas** (used for routing and completion checking in `.network()`) are defined with Zod but **without `.strict()`**
2. When `MastraClient` makes HTTP requests, Zod schemas are **serialized to plain JSON**
3. The serialization **loses type metadata** like `.strict()` modifiers
4. The server receives plain objects and converts them to JSON Schema
5. The resulting JSON Schema **lacks `additionalProperties: false`**
6. OpenAI's strict mode validation **rejects** the schema

### Why Direct Calls Work

If you call `.network()` directly on an `Agent` instance (in-process), the bug **doesn't occur** because:
- No serialization happens
- Zod schemas remain as Zod objects
- Type information is preserved

This is why the bug only manifests in **client-server architectures** (the common production pattern).

## Reproducing the Bug

This repository provides a complete Docker-based reproduction that demonstrates the exact production scenario where the bug occurs.

### Prerequisites

- Node.js 18+ with pnpm
- Docker and Docker Compose
- OpenAI API key

### Quick Start

1. **Clone and install dependencies:**
   ```bash
   git clone <this-repo>
   cd mastra-network-repro
   pnpm install
   ```

2. **Create `.env` file:**
   ```bash
   OPENAI_API_KEY=your_key_here
   ```

3. **Run the reproduction:**
   ```bash
   pnpm docker:up
   ```

4. **Watch the error occur:**
   ```bash
   # In a separate terminal
   pnpm docker:logs:server
   ```

   You'll see:
   ```
   APICallError: Invalid schema for response_format 'response':
   In context=(), 'additionalProperties' is required to be supplied and to be false.
   ```

5. **Stop containers:**
   ```bash
   pnpm docker:down
   ```

## What Gets Tested

The reproduction creates two Docker containers:

### Server Container (`apps/server`)
- Runs a Mastra HTTP server using `@mastra/express`
- Exposes an orchestrator agent with two sub-agents:
  - **Research Agent**: Simulates web search
  - **Math Agent**: Performs calculations
- Listens on port 4111

### Client Container (`apps/client`)
- Uses `@mastra/client-js` to connect to the server
- Makes a `.network()` call with structured output
- Triggers the serialization that causes the bug

### The Test Flow

```
Client Container                        Server Container
     │                                       │
     │  1. Connect via MastraClient          │
     ├──────────────────────────────────────▶│
     │                                       │
     │  2. Call .network() with              │
     │     structuredOutput schema           │
     ├──────────────────────────────────────▶│
     │                                       │
     │                                       │  3. Mastra routes to
     │                                       │     sub-agents using
     │                                       │     internal schemas
     │                                       │
     │                                       │  4. Converts schemas
     │                                       │     to JSON Schema
     │                                       │
     │                                       │  5. Calls OpenAI API
     │                                       ├─────────▶ OpenAI
     │                                       │
     │                                       │ ❌ 400 Error
     │                                       │◀────────  (invalid schema)
     │                                       │
     │  6. Error propagates back             │
     │◀──────────────────────────────────────┤
```

## Affected Internal Schemas

The bug affects Mastra's internal schemas in `@mastra/core`:

### Routing Schema
Used to decide which agent handles each step:
```typescript
z.object({
  task: z.string(),
  primitiveId: z.string(),
  primitiveType: PRIMITIVE_TYPES,
  prompt: z.string(),
  result: z.string(),
  isComplete: z.boolean().optional(),
  selectionReason: z.string(),
  iteration: z.number(),
  conversationContext: z.array(z.any()).optional()
})
```

### Completion Check Schema
Used to determine if the task is complete:
```typescript
z.object({
  isComplete: z.boolean(),
  completionReason: z.string(),
  finalResult: z.string().optional()
})
```

**Neither schema uses `.strict()`**, which means they don't explicitly set `additionalProperties: false` when converted to JSON Schema.

## Why This Only Affects HTTP Clients

| Scenario | Bug Occurs? | Reason |
|----------|-------------|--------|
| Direct agent call (`agent.network()`) | ❌ No | Schemas stay in-memory as Zod objects |
| HTTP client (`client.getAgent().network()`) | ✅ Yes | Schemas serialized, lose `.strict()` info |
| Single-agent calls (`.generate()`, `.stream()`) | ❌ No | Doesn't use multi-agent routing schemas |

## Baseline Test

The repository also includes a direct call test to confirm the bug is specific to HTTP:

```bash
pnpm repro
```

**Result**: ✅ Success - Direct calls work fine

This proves the bug is **not** in the core `.network()` logic, but in the **HTTP serialization layer**.

## Project Structure

```
mastra-network-repro/
├── apps/
│   ├── server/              # Mastra HTTP server
│   │   ├── package.json
│   │   └── src/
│   │       └── index.ts     # Express server with agents
│   └── client/              # HTTP client
│       ├── package.json
│       └── src/
│           └── index.ts     # MastraClient test
├── docker-compose.yml       # Container orchestration
├── pnpm-workspace.yaml      # Monorepo config
├── repro.ts                # Direct call baseline test
├── FINDINGS.md             # Detailed investigation notes
└── README.md               # This file
```

## Tested Versions

- `@mastra/core`: `1.2.0` (pinned)
- `@mastra/express`: `latest`
- `@mastra/client-js`: `latest`
- `@ai-sdk/openai`: `^3.0.26`
- `zod`: `^4.3.6`

## Expected vs Actual Behavior

### Expected Behavior
The `.network()` call should:
1. Route the task to appropriate sub-agents
2. Use OpenAI's structured output for coordination
3. Return the final structured result to the client

### Actual Behavior
The `.network()` call:
1. Starts routing process
2. Attempts to call OpenAI with internal schemas
3. **Fails with 400 error** due to missing `additionalProperties: false`
4. Never reaches the sub-agents

## Impact

This bug **blocks production deployments** that use:
- ✅ Mastra's multi-agent `.network()` feature
- ✅ OpenAI models (gpt-4, gpt-4o, etc.)
- ✅ Client-server architecture (the recommended pattern)

**Workarounds:**
- Use `.generate()` or `.stream()` instead of `.network()` (loses multi-agent routing)
- Use non-OpenAI models (e.g., Anthropic) if they don't enforce strict schema validation
- Call agents directly in-process (not viable for distributed systems)

## Additional Information

- **Root Cause**: Internal schemas lack `.strict()` + HTTP serialization loses Zod metadata
- **OpenAI API Used**: Responses API (`/v1/responses`)
- **Error Type**: Schema validation (400 Bad Request)
- **Detailed Logs**: See [FINDINGS.md](./FINDINGS.md)

## Related Issues

- [mastra-ai/mastra#12284](https://github.com/mastra-ai/mastra/issues/12284) - Original issue report

## Contributing

If you find issues with this reproduction or have insights into the bug:
1. Open an issue in this repository
2. Reference the original issue: mastra-ai/mastra#12284
3. Include your environment details and test results

## License

ISC
