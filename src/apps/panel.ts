/**
 * ClarifyPrompt compose panel — the iframe side of the MCP Apps extension
 * (io.modelcontextprotocol/ui). Renders a compose_prompt result: original vs
 * final diff, critique dimension scores, pipeline stages — with Accept
 * (records an outcome via save_outcome) and Revise (sends feedback back into
 * the chat) actions.
 *
 * Bundled by scripts/build-panel.mjs into a single self-contained HTML file
 * (the extension's sandbox blocks all external fetches). Excluded from the
 * server tsconfig — this file is DOM code.
 */
import { App } from "@modelcontextprotocol/ext-apps";

type Dim = { name?: string; score?: number; rationale?: string };
type ComposeResult = {
  finalPrompt?: string;
  clarificationRequired?: boolean;
  clarification?: { questions?: Array<{ question?: string; suggestedAnswer?: string; dimension?: string }> };
  optimization?: { id?: string; sessionId?: string; originalPrompt?: string; platform?: string; category?: string };
  grounding?: { id?: string; sessionId?: string; originalPrompt?: string; platform?: string; category?: string };
  critique?: { verdict?: string; overallScore?: number; summary?: string; dimensions?: Dim[] };
  stages?: Array<{ name?: string; stage?: string } | string>;
  revised?: boolean;
  iterations?: number;
};

const app = new App({ name: "ClarifyPrompt Compose Panel", version: "1.0.0" });
const root = document.getElementById("root")!;
let current: ComposeResult | null = null;

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** Word-level LCS diff, rendered as <del>/<ins>. Prompts are small; O(n·m) is fine (capped). */
function diffHtml(a: string, b: string): string {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  if (A.length * B.length > 400_000) return esc(b); // give up on diff for huge prompts
  const n = A.length, m = B.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(esc(A[i])); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(A[i].trim() ? `<del>${esc(A[i])}</del>` : esc(A[i])); i++; }
    else { if (B[j].trim()) out.push(`<ins>${esc(B[j])}</ins>`); else out.push(esc(B[j])); j++; }
  }
  while (i < n) { out.push(A[i].trim() ? `<del>${esc(A[i])}</del>` : esc(A[i])); i++; }
  while (j < m) { out.push(j < m && B[j].trim() ? `<ins>${esc(B[j])}</ins>` : esc(B[j])); j++; }
  return out.join("");
}

function stageNames(stages: ComposeResult["stages"]): string[] {
  // ComposeStage uses `name`; accept `stage` too for forward-compat.
  return (stages ?? []).map((s) => (typeof s === "string" ? s : s?.name ?? s?.stage ?? "")).filter(Boolean);
}

function setStatus(msg: string, cls = "muted") {
  const el = document.getElementById("status");
  if (el) { el.className = cls; el.textContent = msg; }
}

function render(res: ComposeResult) {
  current = res;
  if (res.clarificationRequired && res.clarification?.questions?.length) {
    root.innerHTML = `
      <div class="row"><span class="badge">clarification needed</span></div>
      <h2>ClarifyPrompt needs answers before composing</h2>
      <ul class="questions">
        ${res.clarification.questions.map((q) => `
          <li>${esc(q.question)}${q.suggestedAnswer ? `<br><span class="suggested">suggested: ${esc(q.suggestedAnswer)}</span>` : ""}</li>`).join("")}
      </ul>
      <p class="muted">Answer in chat and re-run compose.</p>`;
    return;
  }

  const opt = res.optimization ?? res.grounding ?? {};
  const original = opt.originalPrompt ?? "";
  const final_ = res.finalPrompt ?? "";
  const platform = opt.platform ?? "";
  const crit = res.critique;
  const verdictCls = crit?.verdict === "accept" ? "accept" : crit?.verdict === "revise" ? "revise" : crit?.verdict ? "reject" : "";
  const targetLabel = platform ? `for ${platform}` : "general purpose";

  root.innerHTML = `
    <div class="row">
      <span class="badge target">${esc(targetLabel)}</span>
      ${crit?.verdict ? `<span class="badge ${verdictCls}">${esc(crit.verdict)}</span>` : ""}
      ${typeof crit?.overallScore === "number" ? `<span class="badge">score ${esc(crit.overallScore.toFixed(1))}/10</span>` : ""}
      ${res.revised ? `<span class="badge">revised</span>` : ""}
      ${stageNames(res.stages).map((s) => `<span class="badge">${esc(s)}</span>`).join("")}
    </div>

    ${original ? `
      <h2>Your prompt</h2>
      <div class="prompt-box original">${esc(original)}</div>` : ""}

    <h2>Optimized${platform ? ` ${esc(targetLabel)}` : ""}${original ? ` <a id="toggle-diff" class="toggle" role="button" tabindex="0">show changes</a>` : ""}</h2>
    <div class="prompt-box" id="opt-box">${esc(final_)}</div>

    ${crit?.dimensions?.length ? `
      <h2>Critique</h2>
      <div class="dims">
        ${crit.dimensions.map((d) => {
          const s = typeof d.score === "number" ? Math.max(0, Math.min(10, d.score)) : 0;
          return `<span class="name">${esc(d.name)}</span><span class="bar"><span style="width:${s * 10}%"></span></span><span class="score">${esc(s)}/10</span>`;
        }).join("")}
      </div>
      ${crit.summary ? `<p class="muted">${esc(crit.summary)}</p>` : ""}` : ""}

    <div class="actions">
      <button id="copy">Copy prompt</button>
      ${opt.id && opt.sessionId ? `<button id="accept" class="primary">Accept</button>` : ""}
      <button id="revise">Revise…</button>
    </div>
    <div id="revise-box" class="hidden">
      <textarea id="feedback" placeholder="What should change? e.g. shorter, add the deadline, plainer words"></textarea>
      <div class="actions"><button id="send-revision" class="primary">Send to chat</button></div>
    </div>
    <div id="status" class="muted"></div>`;

  // "show changes" swaps the optimized block between the plain output and a
  // word-level diff against the original — the plain view is the default so
  // the before/after reads clearly.
  let showingDiff = false;
  document.getElementById("toggle-diff")?.addEventListener("click", () => {
    const box = document.getElementById("opt-box");
    const link = document.getElementById("toggle-diff");
    if (!box || !link) return;
    showingDiff = !showingDiff;
    box.classList.toggle("diff", showingDiff);
    box.innerHTML = showingDiff ? diffHtml(original, final_) : esc(final_);
    link.textContent = showingDiff ? "hide changes" : "show changes";
  });

  document.getElementById("copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(final_);
      setStatus("Copied.");
    } catch {
      // Clipboard API can be blocked in sandboxed iframes; fall back to selection.
      const ta = document.createElement("textarea");
      ta.value = final_; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); setStatus("Copied."); }
      catch { setStatus("Copy blocked by the host — select the text manually."); }
      ta.remove();
    }
  });

  document.getElementById("accept")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget as HTMLButtonElement;
    btn.disabled = true; setStatus("Recording outcome…");
    try {
      await app.callServerTool({
        name: "save_outcome",
        arguments: { optimization_id: opt.id, session_id: opt.sessionId, verdict: "accepted" },
      });
      setStatus("Accepted — ClarifyPrompt will reuse this as a few-shot example for similar prompts.");
      try {
        await app.updateModelContext({
          content: [{ type: "text", text: "The user accepted the optimized prompt from ClarifyPrompt as-is." }],
        });
      } catch { /* optional host capability */ }
    } catch (e) {
      btn.disabled = false;
      setStatus(friendlyToolError(e, "record the outcome"), "muted");
    }
  });

  document.getElementById("revise")?.addEventListener("click", () => {
    document.getElementById("revise-box")?.classList.toggle("hidden");
    (document.getElementById("feedback") as HTMLTextAreaElement | null)?.focus();
  });

  document.getElementById("send-revision")?.addEventListener("click", async () => {
    const fb = (document.getElementById("feedback") as HTMLTextAreaElement | null)?.value.trim();
    if (!fb) { setStatus("Write what should change first."); return; }
    try {
      await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: `Revise the optimized prompt with this feedback, then run compose_prompt again: ${fb}` }],
      });
      setStatus("Sent to chat.");
      document.getElementById("revise-box")?.classList.add("hidden");
    } catch (e) {
      setStatus(friendlyToolError(e, "send this to the chat"), "muted");
    }
  });
}

/**
 * Turn a raw MCP/bridge error into something a person can read. The common one
 * is JSON-RPC -32601 ("Method not found"), which a panel hits when the host
 * doesn't forward the action to the server (or isn't wired to one) — that's a
 * host capability gap, not a user error, so say so plainly.
 */
function friendlyToolError(e: unknown, action: string): string {
  const msg = String((e as Error)?.message ?? e ?? "");
  if (/-32601|method not found/i.test(msg)) {
    return `This host can't ${action} from the panel yet (it didn't forward the action to ClarifyPrompt).`;
  }
  return `Couldn't ${action}: ${msg}`;
}

function applyHostContext(ctx: { theme?: string } | null | undefined) {
  if (ctx?.theme) document.documentElement.setAttribute("data-theme", ctx.theme);
}

// Handlers must be attached BEFORE connect() or the initial tool result is missed.
app.ontoolresult = (result: { structuredContent?: unknown; isError?: boolean; content?: Array<{ type?: string; text?: string }> }) => {
  if (result?.isError) {
    const msg = result.content?.find((c) => c.type === "text")?.text ?? "unknown error";
    root.innerHTML = `<p class="muted">Compose failed: ${esc(msg)}</p>`;
    return;
  }
  const sc = result?.structuredContent as ComposeResult | undefined;
  if (sc) render(sc);
};
app.onhostcontextchanged = (ctx: { theme?: string }) => applyHostContext(ctx);

app.connect().then(async () => {
  try { applyHostContext(await app.getHostContext()); } catch { /* older hosts */ }
}).catch((e: unknown) => {
  root.innerHTML = `<p class="muted">Could not connect to the host: ${esc((e as Error)?.message ?? e)}</p>`;
});
