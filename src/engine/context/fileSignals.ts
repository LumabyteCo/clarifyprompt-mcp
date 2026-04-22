import * as path from 'node:path';
import type { FileSignal } from './types.js';

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.sh': 'bash',
  '.sql': 'sql',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
};

const MAX_EXCERPT_CHARS = 2_000;

export interface FileSignalInputs {
  filePath?: string;
  language?: string;
  excerpt?: string;
}

export function collectFileSignal(inputs: FileSignalInputs): FileSignal | undefined {
  if (!inputs.filePath && !inputs.excerpt && !inputs.language) return undefined;

  const signal: FileSignal = {
    path: inputs.filePath,
    language: inputs.language || (inputs.filePath ? inferLanguage(inputs.filePath) : undefined),
  };

  if (inputs.excerpt) {
    signal.excerpt = truncate(inputs.excerpt, MAX_EXCERPT_CHARS);
  }

  return signal;
}

function inferLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANGUAGE[ext];
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n/* … truncated (${s.length - max} more chars) */`;
}
