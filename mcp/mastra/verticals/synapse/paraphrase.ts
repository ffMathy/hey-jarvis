/**
 * Subscription paraphrasing.
 *
 * People phrase subscriptions in the first person — "when I get home from work" —
 * because that is how they speak. Verticals report in the third person, because that
 * is what a device knows: `person is Mathias, state is arrived home`.
 *
 * Those two share almost no vocabulary, and the static embedder has no contextual
 * understanding to bridge them with: it averages token vectors, so "I" and "person"
 * are simply different tokens pulling in different directions. Measured, the canonical
 * example from the Synapse design scored 0.14 against its own state change — less than
 * half the score floor, so no amount of threshold tuning could recover it.
 *
 * Rewriting the pronouns produces a second phrasing to embed alongside the original.
 * Matching takes the better of the two, so this can only ever help: the original still
 * catches a user-phrased description, and the rewrite catches the machine-phrased one.
 *
 * The output is frequently ungrammatical ("a person get home from work") and that is
 * fine. Nothing reads it. Model2Vec pools token vectors without regard for word order
 * or agreement, so only the vocabulary shift matters.
 */

/**
 * First-person to third-person substitutions, applied in order.
 *
 * `I'm` and `I've` come before the bare `I` so the contraction is not left stranded.
 * Only `I` is case-sensitive — it is always capitalised as a pronoun, whereas matching
 * it case-insensitively would rewrite the letter wherever it appeared alone.
 */
const SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/\bI'm\b/g, 'a person is'],
  [/\bI've\b/g, 'a person has'],
  [/\bI\b/g, 'a person'],
  [/\bmy\b/gi, 'the'],
  [/\bmine\b/gi, 'theirs'],
  [/\bme\b/gi, 'the person'],
  [/\bmyself\b/gi, 'themselves'],
];

/**
 * Rewrites a first-person clause into a third-person one.
 *
 * @param text - The clause as the user phrased it
 * @returns The rewritten clause, or null when there was nothing in the first person
 *
 * @example
 * ```typescript
 * thirdPersonVariant('I get home from work'); // "a person get home from work"
 * thirdPersonVariant('the sun goes down');    // null
 * ```
 */
export function thirdPersonVariant(text: string): string | null {
  const rewritten = SUBSTITUTIONS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );

  return rewritten === text ? null : rewritten;
}
