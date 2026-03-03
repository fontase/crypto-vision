/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * This file is part of free-crypto-news.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * For licensing inquiries: nirholas@users.noreply.github.com
 */

/**
 * GraphQL Query Validation & Security
 *
 * Provides:
 * - Input validation (Zod)
 * - Query depth limiting (max 5)
 * - Complexity / cost analysis (max 1000)
 * - Persisted query support (allowlist of known query hashes)
 */

import { z } from "zod";
import { FIELD_COSTS, LIST_COST_PER_ITEM } from "./schema";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_QUERY_DEPTH = 5;
export const MAX_QUERY_COMPLEXITY = 1000;
export const MAX_QUERY_LENGTH = 4_000; // characters
export const MAX_ALIASES = 10;

// ---------------------------------------------------------------------------
// Input validation schemas (Zod)
// ---------------------------------------------------------------------------

export const GraphQLRequestSchema = z.object({
  query: z.string().min(1).max(MAX_QUERY_LENGTH).optional(),
  variables: z.record(z.unknown()).optional().default({}),
  operationName: z.string().max(100).optional(),
  extensions: z
    .object({
      persistedQuery: z
        .object({
          version: z.number().int().min(1).max(1),
          sha256Hash: z.string().regex(/^[a-f0-9]{64}$/i),
        })
        .optional(),
    })
    .optional(),
});

export type GraphQLRequest = z.infer<typeof GraphQLRequestSchema>;

/** Argument-level validation constraints */
const ARG_LIMITS: Record<
  string,
  Record<string, { min?: number; max?: number }>
> = {
  news: { limit: { min: 1, max: 100 }, offset: { min: 0, max: 10_000 } },
  breaking: { limit: { min: 1, max: 50 } },
  search: { limit: { min: 1, max: 100 } },
  trending: { limit: { min: 1, max: 50 }, hours: { min: 1, max: 168 } },
  whales: { limit: { min: 1, max: 100 }, minUsd: { min: 0 } },
};

// ---------------------------------------------------------------------------
// Persisted queries — sha256 hash → query string
// ---------------------------------------------------------------------------

const PERSISTED_QUERIES: Map<string, string> = new Map([
  // Latest 10 news articles
  [
    "ecf4edb46db40b5132295c0291d62fb65d6759a9ced9853b28e12e98c5461290",
    "{ news(limit: 10) { id title source link timeAgo sentiment } }",
  ],
  // Breaking news
  [
    "b8d0a3e6c7f94d2e1a5b3c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f",
    "{ breaking(limit: 5) { id title source link timeAgo isBreaking } }",
  ],
  // Market overview
  [
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
    "{ sentiment { score label bullish bearish neutral } fearGreed { value classification } }",
  ],
  // Top prices
  [
    "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5",
    '{ prices(symbols: ["btc", "eth", "sol"]) { symbol usd change24h marketCap } }',
  ],
]);

/**
 * Register a new persisted query at runtime (e.g. from APQ flow).
 */
export function registerPersistedQuery(hash: string, query: string): void {
  PERSISTED_QUERIES.set(hash, query);
}

/**
 * Look up a persisted query by hash.
 */
export function resolvePersistedQuery(hash: string): string | undefined {
  return PERSISTED_QUERIES.get(hash);
}

// ---------------------------------------------------------------------------
// Tokenizer (reused from existing parser but moved here for testability)
// ---------------------------------------------------------------------------

export function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < query.length) {
    if (/\s/.test(query[i])) {
      i++;
      continue;
    }
    if (query[i] === "#") {
      while (i < query.length && query[i] !== "\n") i++;
      continue;
    }
    if ("{([])},.:!".includes(query[i])) {
      tokens.push(query[i]);
      i++;
      continue;
    }
    if (query[i] === '"') {
      let s = "";
      i++;
      while (i < query.length && query[i] !== '"') {
        if (query[i] === "\\" && i + 1 < query.length) {
          s += query[i + 1];
          i += 2;
        } else {
          s += query[i];
          i++;
        }
      }
      i++;
      tokens.push(`"${s}"`);
      continue;
    }
    let word = "";
    while (i < query.length && /[a-zA-Z0-9_.\-$]/.test(query[i])) {
      word += query[i];
      i++;
    }
    if (word) tokens.push(word);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Depth calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the maximum nesting depth of a GraphQL query.
 * Returns 0 for a flat query with no selection set.
 */
export function calculateDepth(query: string): number {
  const tokens = tokenize(query);
  let max = 0;
  let current = 0;
  // Skip initial "query"/"mutation"/"subscription" keyword + opening brace
  for (const t of tokens) {
    if (t === "{") {
      current++;
      if (current > max) max = current;
    } else if (t === "}") {
      current--;
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// Complexity / cost calculation
// ---------------------------------------------------------------------------

export interface ParsedField {
  name: string;
  args: Record<string, unknown>;
  fields?: string[];
}

function parseArgValue(tokens: string[], pos: { i: number }): unknown {
  const t = tokens[pos.i];
  if (!t) return null;
  if (t.startsWith('"')) {
    pos.i++;
    return t.slice(1, -1);
  }
  if (t === "[") {
    pos.i++;
    const arr: unknown[] = [];
    while (pos.i < tokens.length && tokens[pos.i] !== "]") {
      if (tokens[pos.i] === ",") {
        pos.i++;
        continue;
      }
      arr.push(parseArgValue(tokens, pos));
    }
    pos.i++;
    return arr;
  }
  if (t === "true" || t === "false") {
    pos.i++;
    return t === "true";
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    pos.i++;
    return parseFloat(t);
  }
  if (t.startsWith("$")) {
    pos.i++;
    return t;
  }
  pos.i++;
  return t;
}

function parseArgs(
  tokens: string[],
  pos: { i: number },
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (tokens[pos.i] !== "(") return args;
  pos.i++;
  while (pos.i < tokens.length && tokens[pos.i] !== ")") {
    if (tokens[pos.i] === ",") {
      pos.i++;
      continue;
    }
    const key = tokens[pos.i];
    pos.i++;
    if (tokens[pos.i] === ":") pos.i++;
    args[key] = parseArgValue(tokens, pos);
  }
  pos.i++;
  return args;
}

function parseSelectionSet(tokens: string[], pos: { i: number }): string[] {
  const fields: string[] = [];
  if (tokens[pos.i] !== "{") return fields;
  pos.i++;
  let depth = 0;
  while (pos.i < tokens.length && !(tokens[pos.i] === "}" && depth === 0)) {
    if (tokens[pos.i] === "{") {
      depth++;
      pos.i++;
      continue;
    }
    if (tokens[pos.i] === "}") {
      depth--;
      pos.i++;
      continue;
    }
    if ("(),:".includes(tokens[pos.i])) {
      pos.i++;
      continue;
    }
    const fieldName = tokens[pos.i];
    if (fieldName && /^[a-zA-Z_]/.test(fieldName)) fields.push(fieldName);
    pos.i++;
  }
  pos.i++;
  return fields;
}

export function parseQuery(query: string): ParsedField[] {
  const tokens = tokenize(query);
  const pos = { i: 0 };
  const fields: ParsedField[] = [];

  if (
    tokens[pos.i] === "query" ||
    tokens[pos.i] === "mutation" ||
    tokens[pos.i] === "subscription"
  ) {
    pos.i++;
    if (pos.i < tokens.length && tokens[pos.i] !== "{" && tokens[pos.i] !== "(")
      pos.i++;
    if (tokens[pos.i] === "(") {
      let depth = 1;
      pos.i++;
      while (pos.i < tokens.length && depth > 0) {
        if (tokens[pos.i] === "(") depth++;
        else if (tokens[pos.i] === ")") depth--;
        pos.i++;
      }
    }
  }

  if (tokens[pos.i] === "{") pos.i++;

  while (pos.i < tokens.length && tokens[pos.i] !== "}") {
    const name = tokens[pos.i];
    if (!name || !/^[a-zA-Z_]/.test(name)) {
      pos.i++;
      continue;
    }
    pos.i++;

    const args = parseArgs(tokens, pos);
    const selFields =
      tokens[pos.i] === "{" ? parseSelectionSet(tokens, pos) : undefined;
    fields.push({ name, args, fields: selFields });
  }

  return fields;
}

/**
 * Calculate the total complexity cost of a parsed query.
 */
export function calculateComplexity(parsedFields: ParsedField[]): number {
  let total = 0;

  for (const field of parsedFields) {
    const baseCost = FIELD_COSTS[field.name] ?? 5;
    const limit = typeof field.args.limit === "number" ? field.args.limit : 20;
    // List fields get per-item multiplier
    const isListField = [
      "news",
      "breaking",
      "search",
      "prices",
      "trending",
      "whales",
    ].includes(field.name);
    const cost = isListField ? baseCost + limit * LIST_COST_PER_ITEM : baseCost;
    total += cost;
  }

  return total;
}

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  message: string;
  path?: string[];
}

/**
 * Validate resolver arguments against known constraints.
 * Returns an array of errors (empty = valid).
 */
export function validateArgs(parsedFields: ParsedField[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const field of parsedFields) {
    const constraints = ARG_LIMITS[field.name];
    if (!constraints) continue;

    for (const [argName, bounds] of Object.entries(constraints)) {
      const value = field.args[argName];
      if (value === undefined || value === null) continue;
      if (typeof value !== "number") continue;

      if (bounds.min !== undefined && value < bounds.min) {
        errors.push({
          message: `Argument "${argName}" on field "${field.name}" must be >= ${bounds.min}, got ${value}`,
          path: [field.name, argName],
        });
      }
      if (bounds.max !== undefined && value > bounds.max) {
        errors.push({
          message: `Argument "${argName}" on field "${field.name}" must be <= ${bounds.max}, got ${value}`,
          path: [field.name, argName],
        });
      }
    }

    // String arg sanitisation: disallow script injection in string args
    for (const [argName, value] of Object.entries(field.args)) {
      if (
        typeof value === "string" &&
        /<script|javascript:|on\w+\s*=/i.test(value)
      ) {
        errors.push({
          message: `Argument "${argName}" on field "${field.name}" contains potentially unsafe content`,
          path: [field.name, argName],
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Full query validation pipeline
// ---------------------------------------------------------------------------

export interface QueryValidationResult {
  ok: boolean;
  errors: ValidationError[];
  parsedFields?: ParsedField[];
  complexity?: number;
  depth?: number;
}

/**
 * Run the full validation pipeline on a raw query string.
 */
export function validateQuery(query: string): QueryValidationResult {
  const errors: ValidationError[] = [];

  // 1. Depth check
  const depth = calculateDepth(query);
  if (depth > MAX_QUERY_DEPTH) {
    errors.push({
      message: `Query depth ${depth} exceeds maximum allowed depth of ${MAX_QUERY_DEPTH}`,
    });
  }

  // 2. Parse
  const parsedFields = parseQuery(query);
  if (parsedFields.length === 0) {
    errors.push({
      message:
        "Could not parse query. Ensure it follows GraphQL syntax: { fieldName(args) { subFields } }",
    });
    return { ok: false, errors, depth };
  }

  // 3. Alias / field count check
  if (parsedFields.length > MAX_ALIASES) {
    errors.push({
      message: `Too many root fields (${parsedFields.length}). Maximum is ${MAX_ALIASES}`,
    });
  }

  // 4. Complexity check
  const complexity = calculateComplexity(parsedFields);
  if (complexity > MAX_QUERY_COMPLEXITY) {
    errors.push({
      message: `Query complexity ${complexity} exceeds maximum allowed cost of ${MAX_QUERY_COMPLEXITY}`,
    });
  }

  // 5. Argument validation
  const argErrors = validateArgs(parsedFields);
  errors.push(...argErrors);

  return {
    ok: errors.length === 0,
    errors,
    parsedFields,
    complexity,
    depth,
  };
}
