# Built-in platform packs

This directory holds the **declarative source of truth** for the 58+ built-in platforms ClarifyPrompt ships with. Each YAML file represents one category (`chat`, `code`, `document`, `image`, `music`, `video`, `voice`) and lists every platform in that category along with its label, description, and syntax hints.

## Contributing a new platform

To add a platform:

1. Open the relevant category file (e.g. `image.yaml` for an image-gen platform).
2. Append a new entry under `platforms:` following the existing schema:

   ```yaml
   - id: my-platform                  # lowercase, hyphenated, unique within the category
     label: My Platform                # human-readable name
     description: One-liner            # what makes this platform interesting
     syntaxHints:                      # platform-specific tokens / parameters / conventions
       - some hint
       - another hint
   ```

3. Run `npm run build` and `npm run test:integration` to verify the new platform loads.
4. Optionally add an eval fixture under `evals/fixtures/` covering your platform.
5. Open a PR.

## Schema

Each YAML file has two top-level keys:

```yaml
category:
  id: <CategoryId>          # one of: chat, code, document, image, music, video, voice
  label: <string>            # display name (e.g. "Image")
  description: <string>      # one-line category description
  defaultPlatform: <id>      # which platform.id is used when the user doesn't specify
  defaultMode: <Mode>        # default output mode (e.g. "detailed")

platforms:
  - id: <string>             # unique within this category
    label: <string>
    description: <string>
    syntaxHints: [<string>]  # array of strings; rendered as a comma-separated list
                             # in the system prompt. Quote any value that contains :
                             # to avoid YAML parsing surprises.
```

## Why YAML, not TypeScript?

Pre-1.5 the platform list lived in `src/engine/config/categories.ts` as TypeScript const arrays. That meant adding a platform required a TypeScript edit, a build, and a deploy. As of 1.5, the data is purely declarative — the TypeScript layer is just a loader. Same runtime API; cleaner contribution path.

The runtime falls back to a built-in default if any YAML file is missing or unparseable, so a malformed pack never bricks the server (you'll see a one-line stderr warning instead).

## Custom platforms (runtime, not build-time)

If you want to add a platform **just for your own install** without contributing it upstream, use the `register_platform` MCP tool — it writes to `~/.clarifyprompt/config.json` and persists across restarts. The YAML files here are for **built-in** platforms shipped with the package.
