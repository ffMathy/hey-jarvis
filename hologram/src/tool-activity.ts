/**
 * Which of Jarvis's tool calls are still running, by their id.
 *
 * A list rather than a flag, because tool calls overlap: an agent can ask for the weather and the
 * calendar in the same turn, and the second answer arriving must not end a thought the first is
 * still having. He is thinking while *any* of them is in flight.
 */
export type ToolCallsInFlight = readonly string[];

/** Nothing running, which is where every conversation starts and ends. */
export const NOTHING_IN_FLIGHT: ToolCallsInFlight = [];

/** One more tool call under way. Repeats are ignored: an id is the call, not a count. */
export function toolCallStarted(inFlight: ToolCallsInFlight, id: string): ToolCallsInFlight {
  return inFlight.includes(id) ? inFlight : [...inFlight, id];
}

/**
 * One fewer.
 *
 * An id that was never started is ignored rather than treated as an error. Answers can arrive for
 * calls this screen never saw begin — it joined a conversation late, or the request event was lost
 * — and the only thing worse than missing a thought is a sphere stuck in one for ever.
 */
export function toolCallFinished(inFlight: ToolCallsInFlight, id: string): ToolCallsInFlight {
  return inFlight.includes(id) ? inFlight.filter((running) => running !== id) : inFlight;
}

/** The one field every tool event carries that matters here. */
export interface ToolCallEvent {
  tool_call_id: string;
}

/** An MCP tool call, which reports its progress in one event rather than two. */
export interface MCPToolCallEvent extends ToolCallEvent {
  state: string;
}

/**
 * The state ElevenLabs uses while an MCP tool is actually running.
 *
 * Every other state ends the thought, including `awaiting_approval` — that one is Jarvis waiting on
 * *you*, which is a different thing from Jarvis working, and showing it as a thought would be
 * saying he is busy when he is idle.
 */
export const MCP_TOOL_STILL_RUNNING = 'loading';

/**
 * How long he goes on thinking after the last call has answered.
 *
 * **A routing request is not one tool call, it is a stream of them.** `routePromptWorkflow`
 * hands back an instruction to poll, and `getNextInstructionsWorkflow` is then called over and
 * over until the plan finishes — each poll blocking up to its own deadline and returning, with
 * a gap before the next one while the voice model reads the response and decides. Drawn
 * literally, that is a sphere dropping out of the thinking state and back into it every ten
 * seconds for as long as the request runs: a flicker that says he keeps finishing and starting
 * again, when what is actually happening is one long thought.
 *
 * So the state is held briefly past the last answer, and any call arriving inside that window
 * simply continues it. Two seconds is longer than the gap between one poll returning and the
 * next going out, and short enough that a single quick lookup still visibly ends.
 *
 * It costs nothing when a thought really is over: the sphere idles two seconds later than it
 * strictly could, which is far cheaper than the alternative of it strobing through a long
 * request. The end of the *conversation* does not wait — see `forget` below.
 */
export const KEEP_THINKING_AFTER_LAST_ANSWER_MS = 2_000;

/** The session callbacks that report Jarvis's tool calls, as `startSession` takes them. */
export interface ToolHandlers {
  onAgentToolRequest: (event: ToolCallEvent) => void;
  onAgentToolResponse: (event: ToolCallEvent) => void;
  onMCPToolCall: (event: MCPToolCallEvent) => void;
}

/**
 * The clock a {@link ToolActivity} settles on, and who hears that he is thinking.
 *
 * The timers are handed in rather than taken from the global scope so that this file keeps the main
 * entry's rule of importing and reaching for nothing, and so that the settling window can be
 * stepped through in a test instead of waited out. `Timer` is whatever the platform's `setTimeout`
 * returns — a number in a browser, an object under Bun.
 */
export interface ToolActivityOptions<Timer> {
  /** Told whether he is thinking, each time that changes, and only then. */
  onChange: (thinking: boolean) => void;
  setTimeout: (callback: () => void, milliseconds: number) => Timer;
  clearTimeout: (timer: Timer) => void;
}

/** Jarvis's thinking state, followed from his tool calls. */
export interface ToolActivity {
  /** Whether he is thinking now: a call is in flight, or the last one answered too recently. */
  thinking: () => boolean;
  /** For `startSession`, which holds them for the life of the session. */
  toolHandlers: ToolHandlers;
  /**
   * Forget everything, for when the conversation ends: the calls in flight and the settling window,
   * at once, with no timer left behind.
   */
  forget: () => void;
}

/**
 * Turns Jarvis's tool calls into the hologram's thinking state, with no framework underneath.
 *
 * Thinking while any call is in flight, held for {@link KEEP_THINKING_AFTER_LAST_ANSWER_MS} past
 * the last answer so a stream of polls reads as one thought, continued rather than restarted by a
 * call inside that window, and dropped at once by {@link ToolActivity.forget}. The session every
 * device runs (`jarvis-session.ts`) keeps one, on the timers it is handed, and tells a screen as it
 * changes.
 *
 * **The same shape the voice firmware uses**, which is where the idea comes from: ESPHome's
 * assistant is a phase machine — idle, listening, thinking, replying — and `on_processing` is what
 * lights the thinking animation on the LED ring (see
 * `home-assistant-voice-firmware/home-assistant-voice.elevenlabs.yaml`). The sphere is the ring. What
 * counts as thinking here is narrower, and deliberately so: a conversation over WebRTC streams, so
 * the gap between you finishing and him replying is usually nothing at all, and what genuinely takes
 * time is a tool call — asking Home Assistant what the lights are doing, or the calendar what
 * tomorrow looks like. That is the wait worth showing, and the only one this reports.
 *
 * `inFlight` stays the exact list of what is running, and the window is kept apart from it as
 * `settling`, because they answer different questions and only one of them is a fact: a fake id
 * parked in the list to hold the drawing would corrupt the one fact here to serve a presentation
 * decision.
 */
export function createToolActivity<Timer>({
  onChange,
  setTimeout,
  clearTimeout,
}: ToolActivityOptions<Timer>): ToolActivity {
  let inFlight = NOTHING_IN_FLIGHT;
  let settling = false;
  let settled: { timer: Timer } | undefined;
  let reported = false;

  const thinking = () => inFlight.length > 0 || settling;

  const report = () => {
    const now = thinking();
    if (now !== reported) {
      reported = now;
      onChange(now);
    }
  };

  const stopSettling = () => {
    if (settled) {
      clearTimeout(settled.timer);
      settled = undefined;
    }
  };

  const update = (next: ToolCallsInFlight) => {
    // The same list back means nothing changed — a repeat, or an answer to a call never seen —
    // and, as with React leaving a render out, the settling window carries on untouched.
    if (next === inFlight) {
      return;
    }
    inFlight = next;
    // Any change ends the window that was running: a new call continues the thought rather than
    // starting a second one, and a last answer starts a window of its own.
    stopSettling();
    if (inFlight.length > 0) {
      settling = true;
    } else if (settling) {
      settled = {
        timer: setTimeout(() => {
          settled = undefined;
          settling = false;
          report();
        }, KEEP_THINKING_AFTER_LAST_ANSWER_MS),
      };
    }
    report();
  };

  return {
    thinking,
    toolHandlers: {
      onAgentToolRequest: ({ tool_call_id: id }) => update(toolCallStarted(inFlight, id)),
      onAgentToolResponse: ({ tool_call_id: id }) => update(toolCallFinished(inFlight, id)),
      // One event with a state on it, rather than a request and a response.
      onMCPToolCall: ({ tool_call_id: id, state }) =>
        update(state === MCP_TOOL_STILL_RUNNING ? toolCallStarted(inFlight, id) : toolCallFinished(inFlight, id)),
    },
    forget: () => {
      stopSettling();
      inFlight = NOTHING_IN_FLIGHT;
      settling = false;
      report();
    },
  };
}
