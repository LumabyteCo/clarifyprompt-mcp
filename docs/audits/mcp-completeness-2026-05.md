# MCP Completeness Audit — `clarifyprompt-mcp@1.6.6`

**Date:** 2026-05-27 · **Baseline:** `clarifyprompt-mcp@1.6.6` · **SDK installed:** `@modelcontextprotocol/sdk@1.29.0` (declared floor `^1.29.0`)
**Scope:** Ground-truth what the engine actually wires versus what the MCP spec + SDK now expose. Diagnostic only — no engine code changes prescribed inline; ends with a sequenced modernization roadmap for the user to greenlight.

---

## TL;DR

ClarifyPrompt's MCP surface is **structurally complete on the basics** (23 tools, 1 resource, stdio transport, ships in the npm registry, listed on Glama) but **strategically dated**:

- All 23 tools register through the **legacy `server.tool()` shorthand**, scheduled for removal in SDK `2.0.0-alpha`. No tool declares `title`, `outputSchema`, or any of the four annotation hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).
- The single registered resource is **a 5-line static JSON dump of `CATEGORIES`** — useful but representative of ~1% of the natural resource surface (traces, packs, memory facts, platforms, instruction files all want to be templated resources).
- The `McpServer` constructor declares **no `capabilities` object** — sampling, elicitation, prompts, logging, completion are all off because we never asked. Two of these (elicitation + tasks) would transform existing UX (`clarify_with_user`, `compose_prompt` revise loop) at high leverage.
- Transport is **hardcoded stdio**. There is no abstraction layer or env switch. A2A — which the user has asked about for the next strategic step — is HTTP-based and therefore blocked behind a transport refactor.

The cheap wins (modernize tool registration, expand resource templates, declare capabilities, ride SDK `1.29` → `2.0` cleanly) are sequentially upstream of the strategic ones (elicitation + tasks + A2A). The roadmap in **§7** orders them.

---

## §1 — Tool registrations (`src/index.ts`, lines 31–897)

All 23 tools use the **legacy** signature:

```ts
server.tool(name: string, description: string, inputSchema: ZodRawShape, handler)
```

The modern equivalent (SDK 1.22.0+) is:

```ts
server.registerTool(name, {
  title?: string,            // human-readable display name distinct from name
  description?: string,
  inputSchema?: ZodType<object>,
  outputSchema?: ZodType<object>,   // typed structured response
  annotations?: {
    title?: string,
    readOnlyHint?: boolean,         // tool only reads, never mutates
    destructiveHint?: boolean,      // tool may delete or invalidate data
    idempotentHint?: boolean,       // calling N times = calling once
    openWorldHint?: boolean,        // tool reaches outside the host
  }
}, handler)
```

### The 23 tools — line, name, era, suggested annotations

| Line | Tool | Era | Suggested annotations |
|---:|---|---|---|
| 31 | `optimize_prompt` | 1.0 | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false` (LLM nondet), `openWorldHint: true` (calls external LLM API) |
| 73 | `list_categories` | 1.0 | `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false` |
| 97 | `list_platforms` | 1.0 | `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false` |
| 118 | `list_modes` | 1.0 | `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false` |
| 127 | `register_platform` | 1.0 | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false` |
| 173 | `update_platform` | 1.0 | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false` |
| 235 | `unregister_platform` | 1.0 | `readOnlyHint: false`, **`destructiveHint: true`**, `idempotentHint: true` |
| 273 | `inspect_context` | 1.2.0 | `readOnlyHint: true`, `idempotentHint: false` (analyzer LLM call), `openWorldHint: true` |
| 301 | `list_traces` | 1.2.0 | `readOnlyHint: true`, `idempotentHint: true` |
| 337 | `get_trace` | 1.2.0 | `readOnlyHint: true`, `idempotentHint: true` |
| 359 | `save_outcome` | 1.2.0 | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false` (records new outcome) |
| 415 | `memory_search` | 1.3.0 | `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: true` (calls embedding API) |
| 450 | `memory_remember` | 1.6.0 | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false` |
| 492 | `memory_forget` | 1.6.0 | `readOnlyHint: false`, **`destructiveHint: true`**, `idempotentHint: true` (bi-temporal soft-delete, safe to re-call) |
| 521 | `memory_list_facts` | 1.6.0 | `readOnlyHint: true`, `idempotentHint: true` |
| 554 | `explain_last_curation` | 1.3.0 | `readOnlyHint: true`, `idempotentHint: true` |
| 614 | `load_knowledge_pack` | 1.3.0 | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true` (may fetch URL + embed) |
| 650 | `list_packs` | 1.3.0 | `readOnlyHint: true`, `idempotentHint: true` |
| 675 | `unload_pack` | 1.3.0 | `readOnlyHint: false`, **`destructiveHint: true`**, `idempotentHint: true` |
| 696 | `clarify_with_user` | 1.4.0 | `readOnlyHint: true`, `idempotentHint: false`, `openWorldHint: true`. **Elicitation candidate (§3).** |
| 728 | `ground_prompt` | 1.4.0 | `readOnlyHint: false`, `openWorldHint: true` |
| 783 | `critique_prompt` | 1.4.0 | `readOnlyHint: true`, `idempotentHint: false`, `openWorldHint: true` |
| 822 | `compose_prompt` | 1.4.0 | `readOnlyHint: false`, `openWorldHint: true`. **Tasks candidate (§3)** — the revise loop is the main long-running flow in the engine. |

**What's NOT declared on any tool today:**
- `title` — every tool's display label is its `name` (e.g. `memory_forget`, not `"Forget a remembered fact"`).
- `outputSchema` — every handler returns `{ content: [{ type: "text", text: JSON.stringify(result) }] }`. Hosts have no typed shape to render; they have to parse the JSON blob themselves or just dump it.
- `annotations` — hosts can't tell `list_categories` (safe, read-only, idempotent) apart from `memory_forget` (destructive) or `load_knowledge_pack` (open-world, potentially slow, network-dependent). Modern hosts use these hints to gate confirmations and shape UI affordances.

**Implication:** the registration modernization is essentially a global s/`server.tool`/`server.registerTool`/ plus declaring the 4-hint annotation tuple and migrating return shape to use `outputSchema`. Estimated effort: **3–4 hours** for all 23, of which most is mechanical and the genuinely novel work is designing each tool's `outputSchema` (the JSON they already return — just typed).

---

## §2 — Resource registration (`src/index.ts`, lines 901–912)

The entire resource surface today:

```ts
server.resource(
  "categories",
  "clarifyprompt://categories",
  { description: "Full category configuration...", mimeType: "application/json" },
  async () => ({
    contents: [{
      uri: "clarifyprompt://categories",
      mimeType: "application/json",
      text: JSON.stringify(CATEGORIES, null, 2),
    }],
  })
);
```

One static resource. Same content as the `list_categories` tool returns. **Not a resource template** (no parameter substitution), **no `subscribe` capability**, **no `list` pagination**, **no `annotations`** field (added to the spec in SDK 1.24.2).

### Natural resources we're not exposing

| Suggested URI template | What it would expose | Tools today that surface this |
|---|---|---|
| `clarifyprompt://platforms/{category}/{id}` | One platform's full config (label, description, syntax hints, instructions, custom-status, overrides) | `list_platforms` (per-category list, no individual detail) |
| `clarifyprompt://traces/{date}/{id}` | Full trace JSON for one optimization, browsable by date | `get_trace` (caller must already know the id) |
| `clarifyprompt://traces/{date}` | Trace index for one day (summaries) | `list_traces` |
| `clarifyprompt://packs/{id}` | Pack metadata + chunk count + scope + source ref | `list_packs` |
| `clarifyprompt://packs/{id}/chunks/{chunk_id}` | Individual pack chunk content (post-load) | none today |
| `clarifyprompt://memory/facts/{scope}` | Live facts under a scope, as a browseable resource | `memory_list_facts` |
| `clarifyprompt://config/instructions/{file}` | Custom instruction `.md` files from `$CLARIFYPROMPT_HOME/instructions/` | none today (only register/update tools) |

**Why this matters:** MCP hosts that support resource browsing (Claude Desktop's resources panel, Cursor's MCP resource tree) get nothing useful from us today. With templated resources they'd show a navigable tree of "platforms / traces by date / loaded packs / remembered facts." Each entry is a stable URI the host can render natively, link to, or pin.

**Implication:** ~1 day of work to add 4–6 resource templates. Most are thin wrappers around existing engine getters (trace reader, pack store, memory store).

---

## §3 — Capability declarations (`src/index.ts`, lines 21–24)

```ts
const server = new McpServer({
  name: "clarifyprompt",
  version: "1.6.5",
});
```

**No `capabilities` object.** The SDK auto-declares `tools` and `resources` because we registered some, but nothing else is on. What we're silently saying "no" to:

| Capability | Spec section | What declaring it unlocks |
|---|---|---|
| `prompts` | MCP `prompts/list` + `prompts/get` | Pre-canned prompt templates the host can list and invoke (different from our tool surface — these are user-runnable, not LLM-callable). Probably not a fit for ClarifyPrompt today; we *compile* prompts rather than ship canned ones. |
| `sampling` | MCP `sampling/createMessage` | The server can ask the host to run an LLM completion. **Strategic interest:** ClarifyPrompt currently requires its own `LLM_API_URL` / `LLM_MODEL` env vars; with sampling, the engine could optionally delegate to whatever model the host is already using. Removes an entire configuration surface for users on Claude Desktop / Cursor / etc. |
| `elicitation` | MCP `elicitation/create` (SDK 1.23.0+, SEP-1036) | The server can ask the user for structured input mid-call. **Perfect fit for `clarify_with_user`** — instead of returning a JSON blob of questions for the host to parse, the engine could surface questions through the spec-blessed channel and have the host render them natively. |
| `tasks` | MCP tasks (SDK 1.24.0+, SEP-1686) | Long-running operations with `tasks/create`, `tasks/get`, `tasks/cancel`, progress notifications. **Perfect fit for `compose_prompt`'s revise loop** — today the host blocks for up to ~30s per call when `max_iterations` is set; with tasks the host can show progress, let the user cancel, and stay responsive. |
| `logging` | MCP `logging/setLevel` + `notifications/message` | Server-to-host log notifications (different from our local JSONL traces, which are server-side files). Hosts can route these into their own log/diagnostic UI. |
| `completion` | MCP `completion/complete` | Argument autocompletion for tool inputs (e.g. fuzzy-match platform IDs as the user types). Quick UX win for the `register_platform` / `update_platform` / `inspect_context` flows. |
| `roots` (client → server) | MCP roots | Filesystem-root negotiation. Our `cwd` arg is already filling this role manually; declaring root awareness would let hosts hand us the actual workspace root explicitly. |

**Implication:** elicitation and tasks are the two high-leverage wins. Sampling is a strategic question (less config vs. lock-in to host model). Completion is a nice UX polish. Roots is a small cleanup. The whole capability declaration block is ~20 LOC; the elicitation + tasks **wiring** is what carries cost.

---

## §4 — SDK feature delta (1.12.1 → 1.29.0 → 2.0.0-alpha)

### Where we are

- **Declared floor (1.6.5):** `^1.29.0`
- **Installed (resolved):** `1.29.0`
- **Latest stable:** `1.29.0` (2026-03-30)
- **Next major in flight:** `2.0.0-alpha.2` (2026-04-01)

### Features available in 1.29 we don't yet use

Sorted by strategic value:

| SDK ver | Feature | Used today? | Lift to adopt | Value |
|---|---|---|---|---|
| 1.22.0 | `registerTool` with input + output ZodType | ✗ | low (mechanical migration of all 23) | medium — typed outputs, foundation for everything else |
| 1.22.0 | SEP-986: tool name format spec | partially (names are snake_case, conformant) | none | low — forward-compat |
| 1.23.0 | **SEP-1036 URL elicitation** | ✗ | medium (rewrite `clarify_with_user` response path) | **high** — native question rendering in hosts |
| 1.23.0 | Zod v4 support (backward-compat) | ✗ (still v3.25 per our pin) | low (bump zod again) | low — perf + ecosystem |
| 1.24.0 | **SEP-1686 Tasks** (long-running ops + polling) | ✗ | medium-high (refactor `compose_prompt` to optional task mode) | **high** — cancellation + progress for revise loop |
| 1.24.0 | Spec baseline `2025-11-25` | partial (we're on the old baseline) | n/a — comes with using new SDK features | medium — alignment with modern hosts |
| 1.24.2 | Optional resource annotations | ✗ | low | low — when we expand resources, declare them |
| 1.25.0 | Output-schema updates supported | ✗ | n/a | low — schema evolution without re-registration |
| 1.27.0 | Tasks: streaming methods for elicitation + sampling | ✗ | medium | high if we adopt tasks + elicitation |
| 1.29.0 | `extensions` field on capability object | ✗ | low | low-medium — advertise ClarifyPrompt-specific extensions |

### Breaking changes coming in 2.0.0-alpha

- **`server.tool()` / `server.prompt()` / `server.resource()` REMOVED** (PR #1419). All 23 tool registrations + 1 resource registration in `src/index.ts` will fail to compile. We must migrate to `registerTool` / `registerPrompt` / `registerResource` *before* riding 2.0.
- **Standard Schema** replaces Zod-specific schemas in user-facing slots (PR #1673). Zod v4 still works (it natively implements the spec); Valibot/ArkType also become valid. Zod v3 is no longer guaranteed.
- **Task orchestration moved out of `ProtocolOptions`** into `capabilities.tasks` on `ServerOptions` (PR #1673). Breaking shape change for anyone using tasks via the old API.
- **Unknown tool calls return JSON-RPC error codes** (`-32602` `InvalidParams`) instead of `CallToolResult { isError: true }` (PR #1389). Clients that branched on `isError` for unknown-tool detection will break.
- **Multi-package split.** The single `@modelcontextprotocol/sdk` becomes `@modelcontextprotocol/client` + `/server` + `/node` + `/hono` + `/express` + `/fastify`. The HTTP-transport substack that bloated our `node_modules` in 1.x becomes opt-in via separate packages — relevant if we add HTTP transport.

**Implication:** the 1.29 → 2.0 jump is real work (a refactor, not a config flip) but the *prerequisite* for safely riding 2.0 is already what we'd want to do on 1.29: migrate to `registerTool`. So the migration plan is **(a) modernize registrations on 1.29 → (b) ride 2.0 when it goes stable, mostly cleanly**.

---

## §5 — Transport architecture (`src/index.ts`, lines 4 + 916–917)

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// ...
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Stdio is hardcoded.** Only one transport imported, only one ever instantiated, bound directly to the server. There is no abstraction layer, no env switch, no factory.

### What's available in the SDK but we can't reach

- `StreamableHTTPServerTransport` (SDK 1.24+) — bidirectional HTTP transport with SSE for server→client messages, the **spec-blessed replacement** for the deprecated `SSEServerTransport`. Session resumption, reconnection, request batching all built in.
- `SSEServerTransport` — deprecated, do not use for new wiring.
- `WebSocketServerTransport` — community-maintained, not first-class.

### Refactor sketch (the minimum)

```ts
// src/transport.ts (new)
export async function createTransport() {
  const mode = process.env.CLARIFYPROMPT_TRANSPORT ?? "stdio";
  switch (mode) {
    case "stdio": {
      const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
      return new StdioServerTransport();
    }
    case "streamable-http": {
      const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
      // also need an http listener to feed requests into the transport
      // ...
      return /* configured transport */;
    }
    default:
      throw new Error(`unknown CLARIFYPROMPT_TRANSPORT: ${mode}`);
  }
}

// src/index.ts
const transport = await createTransport();
await server.connect(transport);
```

**Effort:** ~30 LOC for the factory + stdio path (essentially a refactor of what we already have). HTTP path adds another 50–100 LOC for the Node `http`/`hono`/`express` listener wiring (the SDK does the protocol; we provide the socket).

### Why this matters for A2A

**A2A is HTTP-based.** Google's Agent-to-Agent protocol expects an `/.well-known/agent.json` agent card and HTTP/SSE endpoints for task creation, status, cancellation. Today's stdio-only build literally cannot expose any of these — there is no HTTP socket to bind them to.

**Therefore:** A2A is sequentially blocked behind (a) the SDK modernization, then (b) the transport-factory refactor, then (c) the HTTP transport wiring. It is not parallelizable with the MCP modernization work.

---

## §6 — A2A feasibility (preview for §7)

Now that B4 + the SDK delta are grounded, the A2A feasibility memo (which was originally next-session item 2) reduces to:

1. **Transport surface:** add `CLARIFYPROMPT_TRANSPORT=streamable-http` to the factory above. Bring up an HTTP listener.
2. **Agent card:** expose `/.well-known/agent.json` declaring one A2A skill — `compile-prompt-for-platform` — with input shape (prompt, platform, optional context overrides) and output shape (compiled prompt + metadata).
3. **Task surface:** map A2A's `task/create` → engine's `compose_prompt`, `task/get` → poll handler, `task/cancel` → engine cancellation token (which we'd need to add — does not exist today).
4. **Cancellation primitive in the engine:** every LLM call inside `optimize_prompt`/`critique_prompt`/`compose_prompt` needs to take an `AbortSignal` it passes to `fetch`. Currently they don't — that's the only real engine work A2A demands.
5. **Async response handling:** A2A tasks can complete over minutes; the host polls. Today's engine returns synchronously. The task wrapper would need its own state machine (queued → running → succeeded/failed/cancelled).
6. **Same package or split?** A `clarifyprompt-a2a` wrapper package is cleaner — the A2A surface is bigger than the MCP surface and pulls in HTTP framework deps. Lets stdio users stay slim.

**Estimated effort to first viable A2A surface:** ~3 days, gated on items (1)–(2) of §7 below.

---

## §7 — Modernization roadmap (sequenced, with effort + value)

Each step is independently shippable as a minor version bump. Effort estimates assume one engineer, AI-assisted.

| # | Step | Version | Effort | Value | Blocked by |
|---:|---|---|---|---|---|
| 1 | **Migrate all 23 tool registrations to `registerTool`** with `title` + `outputSchema` + the 4-annotation tuple. Migrate the 1 resource to `registerResource`. | 1.7.0 | 3–4h | medium-high — typed outputs, hosts can render confidently, foundation for everything | nothing |
| 2 | **Expand resource templates** — add `platforms/{category}/{id}`, `traces/{date}/{id}`, `traces/{date}`, `packs/{id}`, `memory/facts/{scope}`. Add resource annotations. | 1.7.0 (bundled) or 1.8.0 | 1 day | medium — MCP hosts get a real browseable resource tree | #1 (uses `registerResource`) |
| 3 | **Declare server capabilities explicitly** — `prompts: false`, `sampling: false`, `elicitation: true` (pre-declared, wired in #4), `tasks: true` (pre-declared, wired in #5), `logging: true`, `completion: true`. Then wire `completion/complete` for platform-id autocomplete. | 1.8.0 | half day | medium — hosts know what they can ask for | #1 |
| 4 | **Wire elicitation into `clarify_with_user`.** Replace JSON-blob question return with spec-channel elicitation. Host renders questions natively; engine receives structured user answers as elicitation results. | 1.9.0 | 1 day | **high** — major UX upgrade | #3 |
| 5 | **Wire tasks into `compose_prompt`'s revise loop.** Add optional `task: true` parameter; when set, return a task id immediately and run the loop in background. Wire `tasks/get` to return current iteration status. Add cancellation via `AbortSignal` plumbing through all LLM calls (also needed for A2A, see §6). | 1.10.0 | 2 days | **high** — UX upgrade + foundation for A2A | #3 |
| 6 | **Transport-factory refactor** — extract `createTransport()`, add `CLARIFYPROMPT_TRANSPORT` env. Stdio remains the default. Add `streamable-http` mode with Node `http` listener wiring. | 1.11.0 | 1 day | low-medium standalone; **critical path for A2A** | #5 (cancellation primitive ships there) |
| 7 | **A2A surface** in a separate `clarifyprompt-a2a` wrapper package. `/.well-known/agent.json` + task endpoints + the `compile-prompt-for-platform` skill mapping. | 2.0.0 (or `clarifyprompt-a2a@0.1.0`) | 3 days | **high** strategic — opens adoption channel with multi-agent frameworks (CrewAI, LangGraph, AutoGen, Google ADK) | #6 |

**Optional parallel track at any point:**
- Ride SDK 2.0 stable when it lands — after step #1 this is mostly a low-friction migration. Standard Schema (Zod v4 / Valibot / ArkType) becomes available; multi-package split lets us drop unused HTTP deps when we're stdio-only.

### Three coherent stopping points

- **Stop at #3:** modernization-only. Engine UX unchanged, hosts get richer surface. ~1 week of work, no behavior change for end users.
- **Stop at #5:** UX-upgrade pass. Elicitation + tasks deliver visible improvements without HTTP. ~2.5 weeks. Strong "the engine got better" story.
- **Stop at #7:** A2A enabled. New adoption surface unlocked. ~4 weeks. Real strategic milestone.

User-sovereignty rule applies: this is the menu, not a commitment.

---

## Appendix — Verification trace

All findings in this audit were grounded by direct file inspection during session `2026-05-27`:

- Tool count + registration pattern: `grep -nE "^server\.(tool|resource)" src/index.ts | wc -l` → 23 tool + 1 resource
- Each tool's name + line: `grep -nE '"[a-z_]+",$' src/index.ts` (matched the 23 quoted name args)
- Resource shape: read of `src/index.ts:901-912`
- Server-constructor capabilities: read of `src/index.ts:21-24`
- Transport instantiation: read of `src/index.ts:4 + 916-917`
- SDK installed version: `npm ls @modelcontextprotocol/sdk` → 1.29.0
- SDK declared floor: `package.json:33` → `^1.29.0` (bumped in 1.6.5)
- SDK release-note delta 1.13.0 → 1.29.0: `gh api repos/modelcontextprotocol/typescript-sdk/releases`
- 2.0-alpha breaking changes: same API, filtered for `^@modelcontextprotocol/.*@2\.0\.0-alpha`
- Open CVEs in 1.12.x line: `npm audit` against pre-bump state showed CVE-2026-0621 + GHSA-345p-7cg4-v4c7 + 7 transitive

This audit deliberately did not modify any engine code — its job was diagnostic. The `1.6.5` release that preceded this doc was a security-floor bump only (SDK + zod), not a registration modernization. Step #1 of §7 is the first real engine work this audit prescribes.

---

**Next-session entry point:** read this doc, then the user picks a stopping point (`#3` / `#5` / `#7`) and the modernization sequence kicks off.

---

## Addendum (2026-07-03) — post-roadmap status & 2026-07-28 spec impact

The 7-step roadmap above is **complete** (7/7, shipped 1.6.5 → 1.12.0; see CHANGELOG). Status of the §3 capabilities that were *not* covered by the seven steps, re-graded against the **2026-07-28 spec release candidate** (RC locked 2026-05-21):

| Capability | New status | Why |
|---|---|---|
| `sampling` | **won't do** | Deprecated by SEP-2577 in the 2026-07-28 RC ("new implementations SHOULD NOT adopt sampling"; ≥12-month removal window). The "delegate to host model" idea is dead — Claude Code never shipped client-side sampling anyway (anthropics/claude-code#1785). Use direct provider APIs (we already do). |
| `roots` | **won't do** | Deprecated by SEP-2577 alongside sampling. Our manual `cwd` argument stays. |
| `logging` | **won't do** | Deprecated by SEP-2577. Local JSONL traces + `notifications/progress` (shipped 1.10.0) cover the need. |
| `prompts` | **skip (unchanged)** | Original audit verdict stands: we compile prompts, we don't ship canned ones. No spec-level change in the RC. |
| `tasks` | **still deferred — track SEP-2663** | Graduates from experimental core to an official *extension* in 2026-07-28 with a redesigned, statelessness-compatible lifecycle (breaking vs the experimental API we deliberately skipped at 1.10.0). Still zero verified client adoption (Claude Code FR #18617 open). Revisit when a client ships it; our AbortSignal + progress + A2A task store groundwork is ready. |
| resource `subscribe` / pagination | **defer past 2026-07-28** | The RC makes MCP stateless at the protocol layer (SEP-2575 removes the initialize handshake, SEP-2567 removes `Mcp-Session-Id`, SEP-2322 replaces SSE streams). Build subscriptions after the dust settles, on SDK v2. |

**Next modernization step (call it #8): ride SDK v2 when it goes stable** (beta since 2026-06-29; stable lands with the 2026-07-28 spec). Impact here: package split (`@modelcontextprotocol/server` + adapters), Standard Schema (zod v4), ESM-only/Node 20+, and the statelessness changes hit our `streamable-http` transport and elicitation flow. The hard prerequisite (registerTool/registerResource migration) shipped in 1.7.0, so the ride is estimated at 0.5–1 day. 1.x receives security fixes for ≥6 months after v2 ships.
