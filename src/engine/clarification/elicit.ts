// Elicitation bridge (1.9.0, roadmap #4) — render clarifying questions as a
// native MCP elicitation form and merge the user's answers back.
//
// MCP's `elicitation/create` accepts only a FLAT object schema of primitive
// fields (string / number / boolean / enum). Clarify questions map cleanly:
// each becomes one string field, options become an enum (dropdown), and the
// suggested answer is the field default. These helpers are pure and unit-tested;
// the server-side capability gate + elicitInput call live in src/index.ts.

import type { ClarifyQuestion } from "./clarify.js";

/** One field of an MCP elicitation form schema (primitive string field). */
export interface ElicitField {
  type: "string";
  title?: string;
  description?: string;
  enum?: string[];
  enumNames?: string[];
  default?: string;
}

export interface ElicitationForm {
  type: "object";
  properties: Record<string, ElicitField>;
  required?: string[];
}

const DIM_LABEL: Record<string, string> = {
  audience: "Audience",
  scope: "Scope",
  format: "Format",
  length: "Length",
  tone: "Tone",
  constraints: "Constraints",
  goal: "Goal",
  platform: "Platform",
  other: "Detail",
};

/** Stable per-question form key: q1, q2, … (1-indexed for readable forms). */
export const questionKey = (index: number): string => `q${index + 1}`;

/**
 * Render clarifying questions as an MCP elicitation form schema. Questions with
 * `options` become enum dropdowns; others become free-text. The suggested answer
 * is the field default so the user can accept it in one click. Fields are NOT
 * marked required — leaving one blank means "use the suggested answer"
 * (see applyElicitedAnswers), so accepting the form with all defaults still
 * yields a complete answer set.
 */
export function buildElicitationForm(questions: ClarifyQuestion[]): ElicitationForm {
  const properties: Record<string, ElicitField> = {};
  questions.forEach((q, i) => {
    const field: ElicitField = {
      type: "string",
      title: DIM_LABEL[q.dimension] ?? "Detail",
      description: q.question,
    };
    if (q.options && q.options.length > 0) {
      field.enum = q.options;
      // A default must be one of the enum values, or clients reject the form.
      if (q.suggestedAnswer && q.options.includes(q.suggestedAnswer)) {
        field.default = q.suggestedAnswer;
      }
    } else if (q.suggestedAnswer) {
      field.default = q.suggestedAnswer;
    }
    properties[questionKey(i)] = field;
  });
  return { type: "object", properties };
}

export interface ElicitedAnswer {
  question: string;
  dimension: string;
  answer: string;
  /** true when the field was left blank and we fell back to the suggested answer. */
  usedSuggested: boolean;
}

/**
 * Merge a client's elicitation `content` back onto the questions. A blank or
 * missing field falls back to that question's suggested answer, so an "accept"
 * with all defaults is still a complete, usable answer set.
 */
export function applyElicitedAnswers(
  questions: ClarifyQuestion[],
  content: Record<string, unknown> | undefined,
): ElicitedAnswer[] {
  return questions.map((q, i) => {
    const raw = content?.[questionKey(i)];
    const provided = raw !== undefined && raw !== null && String(raw).trim() !== "";
    return {
      question: q.question,
      dimension: q.dimension,
      answer: provided ? String(raw) : q.suggestedAnswer,
      usedSuggested: !provided,
    };
  });
}
