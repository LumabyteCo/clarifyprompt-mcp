# Security Policy

## Supported versions

We actively maintain the latest minor version line. Older minor versions receive critical security fixes only.

| Version | Supported |
|---------|-----------|
| 1.3.x   | ✅ actively maintained |
| 1.2.x   | 🟡 security fixes only (through 2026-10-24) |
| < 1.2   | ❌ no support |

## Reporting a vulnerability

**Please do NOT open a public GitHub issue for security bugs.** Report privately so we can coordinate a fix before disclosure.

- **Preferred:** [GitHub Security Advisory](https://github.com/LumabyteCo/clarifyprompt-mcp/security/advisories/new) — encrypted, tracked, notifies all maintainers.
- **Backup:** email `ar@lumabyte.co` with the subject line `[SECURITY] clarifyprompt-mcp — <short summary>`.

What to include:
- A clear description of the issue + the impact (privilege escalation? data exfiltration? denial of service?).
- Affected versions.
- A minimal reproducer — the prompt / tool call / config that triggers it.
- Your assessment of exploitability (local only, network, requires a specific MCP host, etc.).
- (Optional) a suggested fix.

## Response targets

| Severity | Acknowledge within | Fix or mitigation within |
|----------|--------------------|--------------------------|
| Critical (unauthenticated RCE, key exfiltration) | 48h | 7 days |
| High (authenticated data leak, privilege escalation) | 72h | 14 days |
| Medium / Low | 7 days | 30 days or next scheduled release |

Maintainer availability is best-effort — this is Apache-2.0 open source, not a paid support contract. We will communicate if a target will slip.

## Disclosure

We follow **coordinated disclosure**: once a fix is available and released, we publish a GitHub Security Advisory with:
- The affected versions.
- The fixed version.
- A CVE where applicable.
- Credit to the reporter unless they request anonymity.

## Threat model (what ClarifyPrompt trusts and doesn't)

Useful context when deciding if something is a vulnerability:

### What ClarifyPrompt trusts
- **The local filesystem.** We read `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `package.json`, and file excerpts you pass in. You control what's on disk; we treat it as authoritative.
- **`$CLARIFYPROMPT_HOME`.** The memory DB, traces, and loaded packs are yours. We don't encrypt at rest — treat the directory like any other sensitive config directory (home-only perms).
- **The LLM endpoint you configure via `LLM_API_URL`.** We send prompts, system messages, and (for reflection) fragments of past interactions. If you don't trust the endpoint, don't point ClarifyPrompt at it.
- **The embedding endpoint via `EMBED_API_URL`.** Same contract.

### What ClarifyPrompt does NOT trust by default
- **Inline knowledge packs from arbitrary URLs.** `load_knowledge_pack` will fetch from any HTTPS URL you give it; there's no signature verification in 1.3. Load packs only from sources you trust. Signed packs are on the 1.4+ roadmap.
- **Outbound network calls beyond the configured endpoints.** We do *not* phone home, collect telemetry, or make callbacks to any LumabyteCo infrastructure. If you see unexpected network traffic from a ClarifyPrompt process, that's a vulnerability — report it.
- **Untrusted optimized-prompt content.** ClarifyPrompt can be asked to optimize a prompt that contains adversarial instructions. We don't execute those instructions ourselves — but the downstream LLM you route the optimized prompt to might. Sandbox accordingly.

### Known non-vulnerabilities
- ClarifyPrompt writes traces by default to `$CLARIFYPROMPT_HOME/traces/`. Those traces contain the prompts you sent. Set `CLARIFYPROMPT_TRACE=off` if that's a problem in your environment. Not a bug.
- The memory DB is a single SQLite file. Anyone with read access to `$CLARIFYPROMPT_HOME/memory/memory.db` can read everything ClarifyPrompt has learned. Same mitigation — directory perms.

## Scope

In scope:
- Remote code execution via malicious prompt / tool-call
- Data exfiltration from `$CLARIFYPROMPT_HOME` via prompt injection
- Unintended outbound network calls
- Dependency-chain vulnerabilities in ClarifyPrompt's direct deps (we triage and fix; transitive deps we forward upstream)
- Misuse of `better-sqlite3` / `sqlite-vec` that allows SQL injection in *our* code

Out of scope:
- Vulnerabilities in the LLM or embedding endpoint you configure (report those to the upstream provider).
- MCP host bugs (Claude Desktop / Cursor / etc. — report to their vendors).
- Social-engineering scenarios where the attacker already has arbitrary filesystem or network access to your machine.

## Signing

Signed releases via [sigstore/cosign](https://github.com/sigstore/cosign) are planned for 1.4. Today, trust is anchored in the npm publish provenance attestation (enabled in CI on tag push) and the GitHub-verified commit signatures.
