<!--
Thanks for the PR. Please fill out as much of this as applies.
For small docs/typo fixes, most of this can be skipped — just describe what you changed and why.
-->

## Summary

<!-- One-paragraph summary of what this PR changes and why. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Refactor / internal cleanup (no user-visible change)
- [ ] Docs / CHANGELOG only
- [ ] **Breaking change** (requires major-version bump + CHANGELOG breaking-changes note)

## Which pillar?

<!-- See README → Context Curator for the four context-engineering pillars. Delete the ones that don't apply. -->
- System instructions
- MCP & external data
- Tools
- Message history
- Cross-cutting / infrastructure
- Not applicable

## Testing

<!-- Describe how you verified the change. For engine-level changes please run /tmp/clarify-integration-test.mjs or the Day-2 battery and paste the final line. -->

- [ ] `npm run build` passes locally
- [ ] Integration battery passes (or N/A)
- [ ] Manual smoke test against a real MCP host (or N/A)
- [ ] New tests added for this change (if behavior change)

## Checklist

- [ ] CHANGELOG.md updated with a bullet under the next unreleased version (or added a new `## [Unreleased]` section)
- [ ] README updated if user-facing (new env var, new tool, new field in a response)
- [ ] No secrets (API keys, tokens, PII) committed — search your diff for `sk-`, `sk-ant-`, `AIza`, etc.
- [ ] Version bumped *only* if this PR is the one that ships a release (otherwise leave version alone)
- [ ] If this adds a new MCP tool or changes an existing tool's schema: update `server.json` env-var declarations if relevant

## Linked issues

<!-- Closes #123 / Related to #456 -->
