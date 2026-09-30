/**
 * How long, and in what voice, Jarvis should answer a request.
 *
 * Decided before any work runs, by whichever of the planner or the routing classifier settles the
 * request, because that is the one place that reads every request with its intent in view. The
 * voice model is told the result through the closing instruction (see `responseStyleInstructions`
 * in `workflows.ts`), which arrives exactly when it is about to speak.
 *
 * The test is where the value of the request lands. A command's value is in the house or on the
 * phone, and the words only confirm it, so they should be as few as possible. A lookup's value is
 * the words, but only a few of them. A briefing's value is the words, and there are many. A
 * conversation's value is the exchange itself, which is where Jarvis's wit earns its keep.
 */
export const RESPONSE_STYLES = ['command', 'lookup', 'briefing', 'conversation'] as const;

export type ResponseStyle = (typeof RESPONSE_STYLES)[number];

/**
 * What each style means, worded once for both the planner's instructions and the classifier's
 * criteria, so the two cannot come to disagree about what a `lookup` is.
 */
export const RESPONSE_STYLE_DESCRIPTIONS: Record<ResponseStyle, string> = {
  command:
    'it changes something in the world, and the words only confirm it: lights, blinds, music, scenes, heating, an alarm or timer, adding to the shopping or to-do list, sending a message. He wants it done, not described',
  lookup:
    'it asks for one fact: is the door locked, the weather now, when the next meeting is, how long the drive takes',
  briefing:
    'it asks for several facts or a summary: the calendar for the week, new emails, research, a recipe, a status report',
  conversation: 'it is open-ended: an opinion, advice, planning something together, chat',
};
