---
name: anthropic-brand-voice
version: 1.0.0
description: Anthropic's public brand voice — tone, register, and content patterns used in Claude docs and the Anthropic blog.
scope: user
author: LumabyteCo
license: Apache-2.0
tags: [brand, voice, tone, anthropic, claude]
---

# Anthropic Brand Voice

## Core tone
Thoughtful, grounded, precise. Avoid hype; prefer demonstration. We write like a working scientist explaining their field to a smart peer from another discipline — no talking down, no jargon walls either.

## Register
Neutral-to-warm. Plain, declarative English is the default. Contractions are fine ("don't", "it's") in docs and blog posts; avoid them in legal / policy. Second person ("you") for user-facing docs; first-person plural ("we") for company voice. Never third-person-distant.

## Words we favour
- "model" (not "AI" when we mean a specific trained artifact)
- "evaluate", "assess", "measure" (not "audit" unless it's a formal audit)
- "capability", "behavior" (not "power", "abilities")
- "safety", "alignment", "harm" (used carefully; these are technical terms in our context)
- "assistant" when referring to Claude in a user-facing product context
- "research" as a collective noun (not "researches")

## Words we avoid
- "groundbreaking", "revolutionary", "unprecedented" — hype words.
- "AGI" in marketing copy. The term is academically contentious; use "advanced AI systems" or name the specific capability.
- "magical", "smart enough to..." — vague anthropomorphism.
- "simply", "just", "easily" — dismissive of the reader's difficulty.
- Exclamation marks in body text. They read as marketing.

## Structure
- Open with the concrete claim or question, not backstory.
- Use headings liberally — scannability beats prose elegance for technical content.
- Code and commands go in fenced blocks with the language tag (```python, ```bash, ```json).
- Link to papers / research for substantive claims; link to docs for how-to claims.
- End product pages with an explicit next step (quickstart link, API reference, sample repo).

## Safety framing
When discussing limitations, failure modes, or risks: be specific. "Claude may produce incorrect information in [domain]" not "Claude isn't perfect." Name the failure type, describe the mitigation, and quantify where possible ("on benchmark X, we measured Y% helpful and Z% refusal").

## Examples
- **Good:** "Claude 4 improves on long-context tasks by 32% on our internal benchmark. Evaluate against your own data before production deployment."
- **Avoid:** "Claude 4 is our most powerful model yet — an AI that truly understands your needs!"
- **Good:** "This guide assumes you're familiar with REST APIs and have a Python environment."
- **Avoid:** "Simply install the SDK and you're ready to build amazing things!"

## Inclusive writing
- Use gender-neutral pronouns in examples ("they" for a generic user).
- Diverse names in code examples ("Priya", "Wei", "Aisha", "Jorge") — avoid the John/Jane default.
- Accessibility: always include alt text on images; prefer descriptive link text over "click here".

## International English
Default to American spellings in code + docs (`color`, not `colour`). British authors can keep their house style in long-form blog posts if it's consistent within the piece.
