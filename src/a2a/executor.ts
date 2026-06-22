// A2A AgentExecutor (1.12.0, roadmap #7) — runs compose_prompt for A2A peers.
//
// This is where the whole roadmap pays off: an incoming A2A message is mapped to
// the compose pipeline; the per-stage onProgress callback (1.10.0) becomes A2A
// TaskStatusUpdateEvents, the AbortSignal (1.10.0) becomes A2A task cancellation,
// and the compiled prompt is returned as an A2A Artifact (text + structured data).

import { randomUUID } from "node:crypto";
import type { AgentExecutor, RequestContext, ExecutionEventBus } from "@a2a-js/sdk/server";
import type {
  Message,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Part,
} from "@a2a-js/sdk";
import { composePrompt } from "../engine/composition/compose.js";
import type { Category } from "../engine/config/categories.js";
import type { ClarifyQuestion } from "../engine/clarification/clarify.js";

interface ParsedInput {
  prompt: string;
  params: Record<string, unknown>;
}

/**
 * Extract the prompt + optional params from an A2A message. Accepts a plain
 * TextPart (the prompt), a TextPart whose text is a JSON object, or a DataPart.
 */
function parseInput(message: Message): ParsedInput {
  let prompt = "";
  let params: Record<string, unknown> = {};
  const absorb = (obj: Record<string, unknown>) => {
    params = { ...params, ...obj };
    if (typeof obj.prompt === "string") prompt = obj.prompt;
  };
  for (const part of message.parts ?? []) {
    if (part.kind === "text") {
      const text = part.text.trim();
      if (text.startsWith("{")) {
        try {
          const obj = JSON.parse(text);
          if (obj && typeof obj === "object") { absorb(obj as Record<string, unknown>); continue; }
        } catch { /* not JSON — fall through and treat as prompt text */ }
      }
      prompt = prompt ? `${prompt}\n${part.text}` : part.text;
    } else if (part.kind === "data") {
      absorb(part.data as Record<string, unknown>);
    }
  }
  return { prompt, params };
}

const PRE_CLARIFY_MODES = new Set(["auto", "always", "never"]);

/** Render clarify questions into a readable A2A `input-required` message. */
function formatClarification(questions: ClarifyQuestion[]): string {
  const lines = [
    "More detail would sharpen this prompt. Answer the question(s) below — or accept the suggested defaults — then re-send the prompt (with the details folded in) on this same task:",
  ];
  questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.question}${q.dimension ? `  [${q.dimension}]` : ""}`);
    if (q.options?.length) lines.push(`   options: ${q.options.join(" | ")}`);
    if (q.suggestedAnswer) lines.push(`   suggested: ${q.suggestedAnswer}`);
  });
  return lines.join("\n");
}

export class ClarifyPromptExecutor implements AgentExecutor {
  // Per-task abort controllers so cancelTask() can stop in-flight work.
  private readonly cancels = new Map<string, AbortController>();

  execute = async (ctx: RequestContext, eventBus: ExecutionEventBus): Promise<void> => {
    const { taskId, contextId } = ctx;
    const { prompt, params } = parseInput(ctx.userMessage);

    // A2A is one-shot agent-to-agent: a peer calling message/send expects a
    // compiled prompt back, not an interactive question it may not be able to
    // answer. So clarify is OFF by default (preClarify='never'); a peer opts in
    // with pre_clarify 'auto'/'always'. And if the prior turn paused on
    // 'input-required', THIS message is the answer — force 'never' so we compile
    // instead of re-asking the same question.
    const resuming = ctx.task?.status?.state === "input-required";
    const requested = typeof params.pre_clarify === "string" ? params.pre_clarify : undefined;
    const preClarify: "auto" | "always" | "never" = resuming
      ? "never"
      : requested && PRE_CLARIFY_MODES.has(requested)
        ? (requested as "auto" | "always" | "never")
        : "never";

    const statusEvent = (state: TaskState, message?: string, final = false): TaskStatusUpdateEvent => ({
      kind: "status-update",
      taskId,
      contextId,
      final,
      status: {
        state,
        timestamp: new Date().toISOString(),
        ...(message
          ? {
              message: {
                kind: "message",
                messageId: randomUUID(),
                role: "agent",
                parts: [{ kind: "text", text: message }],
                taskId,
                contextId,
              } satisfies Message,
            }
          : {}),
      },
    });

    // Announce the task up front. The SDK's ResultManager DROPS any status-update
    // for a task it has never seen (no currentTask, store.load → null), so a
    // terminal event published before the initial Task is silently lost and the
    // peer gets an opaque result. On resume the task already exists in the store
    // (re-publishing would reset its history), so we skip the announce there.
    if (!resuming) {
      const initialTask: Task = {
        kind: "task",
        id: taskId,
        contextId,
        status: { state: "submitted", timestamp: new Date().toISOString() },
        history: [ctx.userMessage],
      };
      eventBus.publish(initialTask);
    }

    if (!prompt.trim()) {
      eventBus.publish(statusEvent("failed", "No prompt provided. Send the prompt as text, or JSON { prompt, platform? }.", true));
      eventBus.finished();
      return;
    }

    const ac = new AbortController();
    this.cancels.set(taskId, ac);

    try {
      eventBus.publish(statusEvent("working", "compiling your prompt"));

      const result = await composePrompt({
        prompt,
        preClarify,
        platform: typeof params.platform === "string" ? params.platform : undefined,
        category: typeof params.category === "string" ? (params.category as Category) : undefined,
        postCritique: params.post_critique === true,
        autoRevise: params.auto_revise === true,
        maxIterations: typeof params.max_iterations === "number" ? params.max_iterations : undefined,
        skipIntentResolution: params.skip_intent_resolution === true,
        signal: ac.signal,
        onProgress: (u) => eventBus.publish(statusEvent("working", u.message)),
      });

      // Peer opted into clarify and the analyzer wants more detail: pause the
      // task in A2A's first-class 'input-required' state, carrying the questions
      // as readable text + a structured DataPart — rather than handing back the
      // un-optimized prompt as if it were compiled. The peer answers by sending
      // a follow-up message on this same task (which resumes with clarify off).
      if (result.clarificationRequired && result.clarification?.questions?.length) {
        eventBus.publish({
          kind: "status-update",
          taskId,
          contextId,
          final: true,
          status: {
            state: "input-required",
            timestamp: new Date().toISOString(),
            message: {
              kind: "message",
              messageId: randomUUID(),
              role: "agent",
              parts: [
                { kind: "text", text: formatClarification(result.clarification.questions) },
                { kind: "data", data: { clarification: result.clarification } as Record<string, unknown> },
              ],
              taskId,
              contextId,
            },
          },
        } satisfies TaskStatusUpdateEvent);
        eventBus.finished();
        return;
      }

      const artifactEvent: TaskArtifactUpdateEvent = {
        kind: "artifact-update",
        taskId,
        contextId,
        artifact: {
          artifactId: randomUUID(),
          name: "optimized-prompt",
          description: "The platform-optimized prompt plus the full compose pipeline result.",
          parts: [
            { kind: "text", text: result.finalPrompt } as Part,
            { kind: "data", data: result as unknown as Record<string, unknown> } as Part,
          ],
        },
      };
      eventBus.publish(artifactEvent);
      eventBus.publish(statusEvent("completed", undefined, true));
      eventBus.finished();
    } catch (err) {
      // The AbortSignal is the authoritative source — compose re-asserts it via
      // checkAbort() whenever set. We also accept a native AbortError name; we do
      // NOT pattern-match the message text (a genuine failure mentioning "cancel"
      // would otherwise be silently reclassified as a clean cancellation).
      const aborted = ac.signal.aborted || (err as Error)?.name === "AbortError";
      eventBus.publish(statusEvent(aborted ? "canceled" : "failed", aborted ? "cancelled by client" : (err as Error).message, true));
      eventBus.finished();
    } finally {
      this.cancels.delete(taskId);
    }
  };

  // Cancellation: abort the in-flight compose. execute()'s catch publishes the
  // terminal 'canceled' status (compose aborts within ~ms via the AbortSignal).
  cancelTask = async (taskId: string): Promise<void> => {
    this.cancels.get(taskId)?.abort();
  };
}
