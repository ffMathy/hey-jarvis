import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { StateChange } from './state-change.js';

/**
 * Standing rules for the State Change Reactor, written as Markdown in the repository.
 *
 * A rule is to state changes what a Claude Code rule is to files: its frontmatter says which
 * state changes it applies to, and its body is instructions the reactor is given whenever one of
 * them arrives. Unlike a subscription or a working-memory preference, a rule lives in the code,
 * so it is reviewed, versioned and never forgotten or expired.
 *
 * ```markdown
 * ---
 * description: Messages from family
 * patterns:
 *   - event: phone/notification_posted
 *     data:
 *       app: com.whatsapp
 *       title: "{mom,dad}*"
 * ---
 * Always tell me about these straight away, even at night.
 * ```
 *
 * A pattern is either a glob matched against the change's `<source>/<stateType>`, or an object
 * with that glob as `event` plus `data`: globs that fields of the state data must also match,
 * addressed by dotted path (`data.button`). A rule applies when any one of its patterns matches.
 *
 * Globs are case-insensitive and `*` matches anything, slashes included, because what they are
 * matched against is free text and ids rather than file paths. Braces (`{a,b}`) and `?` work as
 * usual. An array field matches when any of its elements does.
 */

/** Where the rules are kept, relative to the repository root. */
const RULES_DIRECTORY_FROM_ROOT = path.join('mcp', 'mastra', 'verticals', 'synapse', 'rules');

const GLOB_OPTIONS: picomatch.PicomatchOptions = { bash: true, nocase: true, dot: true };

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const patternSchema = z.union([
  z.string().min(1),
  z.object({
    event: z.string().min(1),
    data: z.record(z.string(), scalarSchema).optional(),
  }),
]);

const frontmatterSchema = z.object({
  description: z.string().optional(),
  patterns: z.array(patternSchema).min(1, 'a rule needs at least one pattern'),
});

/** One pattern a rule applies to. */
export type RulePattern = z.infer<typeof patternSchema>;

/** A rule, as loaded from its file. */
export interface StateChangeRule {
  /** The file name without `.md`. */
  name: string;
  description?: string;
  patterns: RulePattern[];
  /** The Markdown body: what the reactor is told to do. */
  instructions: string;
}

/** A rule that applies to a state change, as the reactor is handed it. */
export interface MatchedRule {
  name: string;
  description?: string;
  instructions: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/**
 * Parses one rule file.
 *
 * Throws with a readable reason when the file is not a valid rule, so a mistake in a rule is
 * reported by name instead of silently applying to nothing.
 */
export function parseRule(name: string, source: string): StateChangeRule {
  const match = FRONTMATTER.exec(source.replace(/^﻿/, ''));
  if (!match) {
    throw new Error(`${name}: a rule must start with a --- frontmatter block`);
  }

  const [, frontmatterText = '', body = ''] = match;
  const parsed = frontmatterSchema.safeParse(Bun.YAML.parse(frontmatterText) ?? {});
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`);
    throw new Error(`${name}: ${reasons.join('; ')}`);
  }

  const instructions = body.trim();
  if (!instructions) {
    throw new Error(`${name}: a rule needs instructions below its frontmatter`);
  }

  return { name, description: parsed.data.description, patterns: parsed.data.patterns, instructions };
}

function readPath(data: Record<string, unknown>, dottedPath: string): unknown {
  let current: unknown = data;
  for (const key of dottedPath.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function valueMatches(value: unknown, isMatch: (text: string) => boolean): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((element) => valueMatches(element, isMatch));
  }
  return isMatch(typeof value === 'object' ? JSON.stringify(value) : String(value));
}

/** Whether one pattern applies to a state change. */
export function patternMatches(pattern: RulePattern, change: StateChange): boolean {
  const { event, data } = typeof pattern === 'string' ? { event: pattern, data: undefined } : pattern;

  if (!picomatch.isMatch(`${change.source}/${change.stateType}`, event, GLOB_OPTIONS)) {
    return false;
  }

  return Object.entries(data ?? {}).every(([field, glob]) =>
    valueMatches(readPath(change.stateData, field), (text) => picomatch.isMatch(text, String(glob), GLOB_OPTIONS)),
  );
}

/** The rules that apply to a state change, in the order they were loaded. */
export function matchRules(rules: readonly StateChangeRule[], change: StateChange): MatchedRule[] {
  return rules
    .filter((rule) => rule.patterns.some((pattern) => patternMatches(pattern, change)))
    .map(({ name, description, instructions }) => ({ name, description, instructions }));
}

/**
 * Finds the rules directory.
 *
 * Next to this file when it runs from source, which is how the MCP server runs. Studio runs
 * `mastra dev`, which bundles this module somewhere else entirely, so the path is also tried from
 * the repository root, which both processes are started in.
 */
export function resolveRulesDirectory(): string | undefined {
  const candidates = [path.join(import.meta.dirname, 'rules'), path.resolve(process.cwd(), RULES_DIRECTORY_FROM_ROOT)];
  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * Loads every rule in a directory, sorted by file name.
 *
 * A rule that does not parse is logged and left out rather than failing the state change it was
 * loaded for. The spec that parses every committed rule is what stops one from being merged.
 */
export function loadRules(directory: string | undefined = resolveRulesDirectory()): StateChangeRule[] {
  if (!directory) {
    return [];
  }

  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.md'))
    .sort();

  return files.flatMap((file) => {
    const name = file.slice(0, -'.md'.length);
    try {
      return [parseRule(name, readFileSync(path.join(directory, file), 'utf8'))];
    } catch (error) {
      logger.error('Skipping an invalid state change rule', {
        rule: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  });
}

let cachedRules: StateChangeRule[] | undefined;

/**
 * The rules that apply to a state change.
 *
 * Rules are read once per process: they only change with a deploy, and this runs for every state
 * change in the house.
 */
export function findRulesForStateChange(change: StateChange): MatchedRule[] {
  cachedRules ??= loadRules();
  return matchRules(cachedRules, change);
}
