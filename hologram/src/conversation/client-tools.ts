/**
 * A client tool as a screen answers it: given the parameters the agent sent, and returning what the
 * agent is told — a string, or nothing for a tool the agent does not wait on.
 *
 * `unknown` rather than the SDK's `any`, so every tool has to narrow what it was sent before using
 * it: the parameters are whatever the model wrote.
 */
export type ClientTool = (parameters: unknown) => string | undefined | Promise<string>;

/** Client tools by name, the way `startSession` takes them. */
export type ClientTools = Record<string, ClientTool>;

/**
 * Several hooks' client tools, as the one `clientTools` option `startSession` takes.
 *
 * **A spread cannot do this.** The hang-up and the camera each answer a tool of their own, and each
 * hands its tools over as a `clientTools` key beside its handlers — so spreading both into the
 * session's options keeps the second key and silently drops the first. The agent then calls a tool
 * the device no longer answers, and the SDK reports it through `onError`, which on a phone is a red
 * line and a toast at the end of every request. `inTurn` is the same repair for handlers.
 *
 * Two hooks answering the same name is a mistake rather than a merge, so it throws — as the SDK's
 * own registry does — instead of quietly keeping one of them.
 */
export function mergeClientTools(...toolSets: ClientTools[]): ClientTools {
  const merged: ClientTools = {};
  for (const tools of toolSets) {
    for (const [name, tool] of Object.entries(tools)) {
      if (name in merged) {
        throw new Error(`Two hooks answer the client tool ${name}.`);
      }
      merged[name] = tool;
    }
  }
  return merged;
}
