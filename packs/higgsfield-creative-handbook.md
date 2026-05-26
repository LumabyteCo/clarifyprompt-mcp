---
name: higgsfield-creative-handbook
version: 1.0.0
description: Higgsfield-specific patterns for prompt construction, model selection, Soul ID character workflow, camera-move vocabulary, and Marketing Studio workflows. Pairs with the higgsfield platform entries in packs/platforms/{image,video}.yaml.
scope: user
author: LumabyteCo
license: Apache-2.0
tags: [higgsfield, video, image, cinema, marketing-studio, soul-id, creative]
---

# Higgsfield Creative Handbook

A reference for compiling prompts that target [Higgsfield](https://higgsfield.ai) — a multi-model creative platform exposing 30+ image and video models through a single hosted MCP at `https://mcp.higgsfield.ai/mcp`. Use this pack alongside the `higgsfield` platform entries to ground prompts in Higgsfield's actual conventions.

The Context Curator pulls chunks from this pack by semantic similarity, so each section is written to stand alone.

## Model selection guide

Higgsfield routes one natural-language prompt to whichever model you specify. Picking the right model matters more than tuning the prompt — these are the rules of thumb worth grounding into the engine.

**Image models, by use case:**

- **Soul 2.0** — flagship lifelike portrait / photographic model. Use for: people, portraits, fashion, lifestyle. Best face-faithfulness when paired with Soul ID.
- **Soul Cinema** — same Soul family with cinematic lighting bias (volumetric light, anamorphic feel, soft falloff). Use for: editorial portraits, brand campaigns, mood-driven hero shots.
- **Soul Cast** — multi-character Soul variant. Use for: scenes with 2–4 people who all need consistent identity (e.g., a recurring cast across an ad campaign).
- **Flux 2** — strongest general-purpose imagery. Use for: non-human subjects, products, environments, abstract / surreal.
- **Seedream 5** — best Asian aesthetic + clean compositional balance + text rendering. Use for: typography in images, packaging design, East-Asia-oriented creative.
- **Nano Banana Pro** — high-control image model. Use for: prompts where you need precise composition (POV, framing, depth of field) to land predictably.
- **GPT Image 2** — best when the prompt mixes text + image semantics tightly (e.g., infographics, scenes with readable signage, code-screenshots in scenes).

**Video models, by use case:**

- **Cinema Studio** — Higgsfield-original cinematic video. Use for: filmic narrative shots, camera-move-heavy clips, the "feature film B-roll" register.
- **Sora 2** — OpenAI's flagship. Use for: photoreal high-fidelity scenes, complex physics, longer clips with story arc.
- **Veo 3.1** — Google's flagship. Use for: 4K-ready output, scenes with built-in audio sync, branded content.
- **Kling 3.0** — strongest motion fidelity at lower cost. Use for: human/animal action, dance, sports, anything where motion realism beats photorealism.
- **WAN 2.6** — best for surreal / stylized motion, anime-adjacent aesthetics, transformation effects.
- **Seedance 2.0** — purpose-built for dance / music-video / rhythmic motion content.

When the user doesn't specify a model, the safe defaults are **Soul 2.0** (image) and **Cinema Studio** (video). When in doubt, surface the choice as a follow-up question rather than guessing.

## Prompt structure pattern

Higgsfield's house style is **long-form natural-language prose**, not keyword-tag soup. The canonical structure (taken from Higgsfield's own Nano Banana Pro prompt guide):

```
[shot type / POV] [subject + key action] [setting + time-of-day] [lighting]
[textures + materials] [color palette + mood] [style cues + lens / film cues]
```

Concrete example (a real Higgsfield-published prompt for Nano Banana Pro):

> Ultra-detailed POV shot from inside a transparent container filled with crushed pink ice, looking upward at a young woman leaning over the opening. She sips through a bright blue straw, her lips glossy and slightly parted, eyes wide with playful curiosity. Sunlight illuminates her face and the sparkling ice crystals, creating vibrant reflections and a summery atmosphere. The background shows a clear blue sky, slight lens distortion, and subtle water droplets on the container walls. Hyperrealistic textures, high-contrast colors, cinematic saturation, crisp details, energetic and refreshing mood.

Note what's NOT there: `--ar`, `--v`, `negative prompt:`, weighting syntax `(word:1.3)`. Higgsfield doesn't use any of those. The model handles aspect ratio + version through its parameter schema, not the prompt.

**Word count target:** 50–120 words. Below 40 feels under-specified; above 150 starts diluting the signal.

**Voice:** present-tense, declarative. "She sips through" not "she is sipping" or "a woman sipping."

## Camera moves (video models)

Higgsfield's video models — especially Cinema Studio and DOP — respond strongly to explicit camera-move language. The vocabulary the platform recognizes:

| Move | Phrasing in prompt |
|---|---|
| Push-in (dolly forward) | "slow push-in toward [subject]" |
| Pull-out (dolly back) | "smooth pull-out revealing [wider scene]" |
| Crane up | "crane shot rising from [subject] to bird's-eye view" |
| Crane down | "crane descent from sky to street level" |
| Orbit / arc | "360-degree orbit around [subject]" / "arc shot from left to right" |
| Tilt up / tilt down | "tilt up from feet to face" / "tilt down from sky to horizon" |
| Pan left / pan right | "slow pan from left to right across the room" |
| Handheld | "handheld with subtle camera shake" |
| Static | "locked-off camera, no movement" |
| Whip pan | "rapid whip pan to [next subject]" |

When the user wants cinematic motion but doesn't specify, push-in or pull-out are the safest defaults — they almost always land well and reveal/establish the subject.

## Soul ID workflow (character consistency)

Soul ID is Higgsfield's killer feature for narrative work: train an identity once from 3–5 reference photos, then reuse it across any subsequent image or video generation. The workflow on the MCP side:

1. **Train** — `soul-id create` with 3–5 reference photos of the subject. Returns a Soul ID UUID. Takes 1–3 minutes.
2. **Wait** — `soul-id wait <id>` blocks until training completes.
3. **Reference** — pass `soul_id: <uuid>` as a parameter to `generate_image` or `generate_video` calls. The model will preserve the trained identity.

When compiling prompts that involve a named character or recurring person, suggest the Soul ID workflow rather than describing the person in prose every time. A compiled prompt should look like:

> [Optimized prose describing the scene] — character reference: Soul ID `{uuid}`.

The prose doesn't need to redescribe the face; Soul ID handles that. The prose focuses on action, setting, lighting, mood.

## Multi-reference editing

Higgsfield's edit-side surface (`edit?model=multi`) takes multiple reference images and composites them. Useful for:

- Product placement: subject in scene A, product in scene B, combined output places the product in scene A naturally
- Style transfer: composition reference + style reference
- Garment swaps: model reference + clothing reference

When the user says "put this product in this scene" or "make this character wear this," route to multi-reference editing rather than text-to-image with a long describing prompt.

## Marketing Studio workflows

Higgsfield's Marketing Studio is a higher-level abstraction on top of the base generation tools. The `show_marketing_studio` MCP tool gives access to:

- **Brand kit** — colors, fonts, tone of voice. Once set, applied automatically to every Marketing Studio generation.
- **Avatars** — pre-built recurring characters for UGC-style content.
- **Products** — uploaded product photos that can be placed into generated scenes.
- **Hooks** — opening lines / first-frame text overlays optimized for retention.
- **Modes** — UGC, TV spot, Wild Card, product unboxing, hero banner, Pinterest pin.
- **Virality Predictor** — scores any generated asset for engagement / hook strength / retention risk.

When the user's intent involves marketing or ad content (signaled by keywords like "ad," "campaign," "promo," "TV spot," "UGC," "Reels," "TikTok"), Marketing Studio modes will produce better results than raw `generate_image` / `generate_video`. Suggest the relevant mode in the compiled prompt.

## Mode presets — when to use which

| User says | Preferred mode |
|---|---|
| "I need a quick TikTok / Reels for my product" | UGC Factory |
| "Hero banner for landing page" | Hero Banner mode (image) |
| "Product unboxing video" | Unboxing mode (video) |
| "Lifestyle product shot" | Lifestyle Mode (image) |
| "Pinterest pin for [topic]" | Pinterest Pin mode (image) |
| "TV-quality 15s spot" | TV Spot mode (video) |
| "Stop-scroll attention grabber" | Wild Card mode (video) |
| "Talking head for VO / lip-sync" | Lipsync Studio (video) |

## Common pitfalls

- **Don't translate Midjourney syntax verbatim.** `--ar 16:9 --v 6.1 --style raw` doesn't work in Higgsfield. Drop the flags; describe the aspect ratio in prose ("widescreen 16:9 composition") if it matters at all, or leave it for the API parameter.
- **Don't use Stable-Diffusion-style negative prompts.** Higgsfield doesn't parse `negative prompt:` — describe what you DO want; the model handles avoidance.
- **Don't redescribe a Soul ID character in prose.** If you've passed a Soul ID, the model has the face. Describing it again in the prompt fights the trained identity and produces inconsistent output.
- **Don't pack > 150 words.** Higgsfield's models lose signal beyond ~120-150 words. Compress.
- **Camera moves need explicit verbs.** "Cinematic shot" alone won't induce camera motion in a video model. Say "slow push-in" or "orbit" or "crane up."
- **Multi-character scenes default to Soul Cast.** If the user wants 2+ named people who should look consistent across generations, route to Soul Cast, not vanilla Soul 2.0.

## Output specs at a glance

- **Image**: up to 4K resolution. Aspect ratio set by the model's parameter, not the prompt.
- **Video**: up to 15 seconds in a single generation. Longer durations require multi-clip composition.
- **Audio**: not generated by image/video models; use Lipsync Studio to add voiceover or dialog to existing video.
- **Credits**: every generation consumes credits at a model-specific rate. Higher-fidelity models (Sora 2, Veo 3.1) cost more than Cinema Studio or Soul. Mention cost-awareness in compiled prompts when the user signals budget concerns.
