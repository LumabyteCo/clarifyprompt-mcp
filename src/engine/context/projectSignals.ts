import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProjectSignal } from './types.js';

const RULES_FILENAMES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  '.clinerules',
  'clarify.md',
  '.clarify/rules.md',
];

const MAX_RULES_BYTES = 16_000;

const FRAMEWORK_SIGNATURES: Array<{ dep: RegExp; framework: string }> = [
  { dep: /^(next)$/, framework: 'Next.js' },
  { dep: /^(nuxt)$/, framework: 'Nuxt' },
  { dep: /^(remix|@remix-run\/)/, framework: 'Remix' },
  { dep: /^(astro)$/, framework: 'Astro' },
  { dep: /^(svelte|@sveltejs\/)/, framework: 'Svelte' },
  { dep: /^(vue)$/, framework: 'Vue' },
  { dep: /^(react)$/, framework: 'React' },
  { dep: /^(express)$/, framework: 'Express' },
  { dep: /^(fastify)$/, framework: 'Fastify' },
  { dep: /^(hono)$/, framework: 'Hono' },
  { dep: /^(nestjs|@nestjs\/)/, framework: 'NestJS' },
  { dep: /^(@modelcontextprotocol\/sdk)$/, framework: 'MCP Server' },
  { dep: /^(langchain|@langchain\/)/, framework: 'LangChain' },
  { dep: /^(llamaindex)$/, framework: 'LlamaIndex' },
  { dep: /^(openai)$/, framework: 'OpenAI SDK' },
  { dep: /^(@anthropic-ai\/sdk)$/, framework: 'Anthropic SDK' },
];

export async function collectProjectSignal(cwd?: string): Promise<ProjectSignal> {
  const signal: ProjectSignal = {
    rootPath: cwd,
    hasClaudeMd: false,
    hasAgentsMd: false,
    hasCursorRules: false,
    hasClarifyMd: false,
    frameworks: [],
    languages: [],
  };

  if (!cwd) return signal;

  const rulesParts: string[] = [];
  for (const fname of RULES_FILENAMES) {
    const p = path.join(cwd, fname);
    const content = await tryReadTextFile(p, MAX_RULES_BYTES);
    if (content) {
      if (fname === 'CLAUDE.md') signal.hasClaudeMd = true;
      if (fname === 'AGENTS.md') signal.hasAgentsMd = true;
      if (fname === '.cursorrules') signal.hasCursorRules = true;
      if (fname === 'clarify.md' || fname === '.clarify/rules.md') signal.hasClarifyMd = true;
      rulesParts.push(`<!-- ${fname} -->\n${content.trim()}`);
    }
  }
  if (rulesParts.length) {
    signal.rulesMarkdown = rulesParts.join('\n\n');
  }

  const pkgPath = path.join(cwd, 'package.json');
  const pkgRaw = await tryReadTextFile(pkgPath, 200_000);
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      signal.packageName = pkg.name;
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      const frameworks = new Set<string>();
      for (const dep of Object.keys(allDeps)) {
        for (const sig of FRAMEWORK_SIGNATURES) {
          if (sig.dep.test(dep)) frameworks.add(sig.framework);
        }
      }
      signal.frameworks = [...frameworks];
      signal.languages.push('TypeScript/JavaScript');
    } catch {
      // malformed package.json — ignore
    }
  }

  // Detect additional languages by lockfile or manifest
  const langHints: Array<{ file: string; lang: string }> = [
    { file: 'pyproject.toml', lang: 'Python' },
    { file: 'requirements.txt', lang: 'Python' },
    { file: 'Cargo.toml', lang: 'Rust' },
    { file: 'go.mod', lang: 'Go' },
    { file: 'pom.xml', lang: 'Java' },
    { file: 'build.gradle', lang: 'Java/Kotlin' },
    { file: 'Gemfile', lang: 'Ruby' },
    { file: 'composer.json', lang: 'PHP' },
  ];
  for (const hint of langHints) {
    if (await fileExists(path.join(cwd, hint.file))) {
      if (!signal.languages.includes(hint.lang)) signal.languages.push(hint.lang);
    }
  }

  return signal;
}

async function tryReadTextFile(filePath: string, maxBytes: number): Promise<string | undefined> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return undefined;
    const fh = await fs.open(filePath, 'r');
    try {
      const size = Math.min(stat.size, maxBytes);
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, 0);
      return buf.toString('utf-8');
    } finally {
      await fh.close();
    }
  } catch {
    return undefined;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
