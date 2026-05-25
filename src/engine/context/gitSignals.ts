/**
 * Git-state signal (C1, 1.6.0).
 *
 * Lightweight read-only git context: current branch, short HEAD SHA, whether
 * the working tree is dirty, and the last few commit titles. Lets the
 * Context Engine ground prompts in "what the user is currently iterating
 * on" — e.g. branch=feat/auth-refactor + last-3 commits about auth signals
 * the engine more strongly than just the package.json frameworks list.
 *
 * Failure mode: silently returns undefined when cwd isn't a git repo, or
 * when git is not on PATH, or when any subcommand fails. This signal is
 * never load-bearing — its job is to enrich, not gate.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GitSignal {
  /** e.g. 'main', 'feat/auth-refactor'. May be undefined on detached HEAD. */
  branch?: string;
  /** 7-char short SHA of HEAD. */
  headShort?: string;
  /** true when working tree has unstaged or untracked changes. */
  dirty: boolean;
  /** Last N commit titles (oneline). Newest first. */
  recentCommits: string[];
}

const COMMIT_LIMIT = 5;
const GIT_TIMEOUT_MS = 1500;

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Walk up from `start` looking for a `.git` directory. Returns the repo
 * root, or undefined if none found within reasonable depth (avoids
 * scanning all the way to /).
 */
function findRepoRoot(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 16; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

export function collectGitSignal(cwd: string): GitSignal | undefined {
  const root = findRepoRoot(cwd);
  if (!root) return undefined;

  const branch = tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  // Detached HEAD returns 'HEAD'; treat that as undefined branch.
  const branchClean = branch && branch !== 'HEAD' ? branch : undefined;

  const headShort = tryGit(root, ['rev-parse', '--short=7', 'HEAD']);

  const statusOut = tryGit(root, ['status', '--porcelain']);
  const dirty = !!statusOut && statusOut.length > 0;

  const logOut = tryGit(root, ['log', `-${COMMIT_LIMIT}`, '--pretty=format:%s']);
  const recentCommits = logOut ? logOut.split('\n').filter(Boolean) : [];

  // Don't return a signal at all if every field is empty — that means we
  // technically found a .git dir but git can't read it (e.g. permissions
  // issue, corrupted repo).
  if (!branchClean && !headShort && !dirty && recentCommits.length === 0) {
    return undefined;
  }

  return {
    branch: branchClean,
    headShort,
    dirty,
    recentCommits,
  };
}
