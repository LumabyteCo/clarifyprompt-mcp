---
name: sox-compliance
version: 1.0.0
description: Sarbanes-Oxley (SOX) Section 404 considerations for AI-assisted work in financial controls environments.
scope: user
author: LumabyteCo
license: Apache-2.0
tags: [compliance, sox, finance, audit, controls]
---

# SOX Compliance Considerations

## What SOX Section 404 requires
Public companies in the U.S. must maintain and test internal controls over financial reporting (ICFR). Management attests to the effectiveness of those controls annually (404(a)); external auditors issue their own attestation (404(b)). This applies to any system that produces, transforms, or relies on data feeding the financials — accounting systems, ERP, revenue systems, payroll, reporting pipelines.

## How AI-generated output interacts with SOX
Any AI-generated artifact that lands in a financial process — a journal entry suggestion, a reconciliation mapping, a sample-selection decision, even a narrative in MD&A — sits in scope for control testing. Three principles:

1. **Preserve human accountability.** An LLM can draft a journal entry, but a human with the right authority must approve it. The approval signature (or equivalent audit trail) is the control, not the AI output.
2. **Trace inputs + outputs.** Every AI-assisted financial output must be reproducible: the prompt, the model + version, the retrieval sources, the final output. If you can't show an auditor the chain of custody, the control fails.
3. **No untested automation in key controls.** If an AI step is part of a "key control" (management review of accruals, reconciliations, close sign-offs), it must be tested as part of SOX scope — including backtests on historical periods.

## Data handling rules
- **Never send personally identifiable financial records to a third-party API without a signed DPA and a risk assessment.** In scope: customer account numbers, employee comp, vendor banking info, consolidated P&L. Use locally-deployed models for these where possible.
- **Data classification must survive the prompt.** If the source data is Confidential-Financial, the prompt and the output are also Confidential-Financial — including logs, traces, and fine-tuning corpora.
- **Retention windows apply to AI outputs too.** If your policy says "retain journal-entry support for 7 years", it applies to the prompt + response transcript, not just the entry itself.

## Prompt-engineering guardrails for SOX work
- Never ask an LLM to produce a final journal entry, adjusting entry, or financial statement line item without a follow-up human review and explicit approval step.
- Include the control context in the prompt: "This entry supports the month-end close for {period}. It will be reviewed by the Controller per control FIN-104." This makes traceability auditable and sets the model's tone.
- For narrative work (MD&A, earnings-release commentary), demand source citations for every quantitative claim. "Revenue grew 14% YoY" needs a source line pointing at the GL or the finance data-mart query.
- When drafting memos (revenue recognition, lease accounting, goodwill impairment), include the ASC / IFRS citation in the prompt so the model anchors on the standard, not a paraphrase.

## Model and tooling choices
- **Preferred for SOX scope:** locally-deployed models (Llama, DeepSeek, Qwen via Ollama/vLLM) or hosted models with explicit SOC 2 / ISO 27001 compliance and a DPA (OpenAI Enterprise, Anthropic for Enterprise, Azure OpenAI). Avoid consumer tiers for any real financial data.
- **Logging is mandatory.** Every AI-assisted action on in-scope data needs to land in a tamper-evident log (append-only, retention-locked). Self-hosted JSONL is fine if the storage is access-controlled and retention-protected.

## Sample-selection integrity
If AI selects audit samples, the selection method must be disclosed to the auditor, reproducible from a seed + inputs, and demonstrably non-biased. A prompt like "pick 25 representative invoices" is NOT a defensible sampling method. Use deterministic statistical sampling (random with seed, MUS, stratified) and have the AI help with the explanation, not the selection.

## Bottom line
Treat AI-assisted financial work like any other third-party-assisted work: document the control, preserve the evidence, make sure a competent human owns every approval, and test it on real historical data before you rely on it. When in doubt, ask your SOX PMO before adding a new AI step to a key control.
