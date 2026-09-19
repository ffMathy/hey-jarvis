import { useCallback, useEffect, useMemo, useState } from 'react';

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
interface ToolCall {
  tool_call_id: string;
}

/** An MCP tool call, which reports its progress in one event rather than two. */
interface MCPToolCall extends ToolCall {
  state: string;
}

/**
 * The state ElevenLabs uses while an MCP tool is actually running.
 *
 * Every other state ends the thought, including `awaiting_approval` — that one is Jarvis waiting on
 * *you*, which is a different thing from Jarvis working, and showing it as a thought would be
 * saying he is busy when he is idle.
 */
const STILL_RUNNING = 'loading';

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
 * request. The end of the *conversation* does not wait — see `forgetToolCalls`.
 */
export const KEEP_THINKING_AFTER_LAST_ANSWER_MS = 2_000;

/**
 * Turns Jarvis's tool calls into the hologram's thinking state.
 *
 * **The same shape the voice firmware uses**, which is where this idea comes from: ESPHome's
 * assistant is a phase machine — idle, listening, thinking, replying — and `on_processing` is what
 * lights the thinking animation on the LED ring. See
 * `home-assistant-voice-firmware/home-assistant-voice.elevenlabs.yaml`. A phone has no LED ring, so
 * the sphere is the ring: the drawing has a whole state for this, a plane sweeping up through him
 * with the swarm gone quiet behind it, and until now nothing ever turned it on outside sample mode.
 *
 * What counts as thinking here is narrower than the firmware's `on_processing`, and deliberately
 * so. The firmware is thinking for the whole gap between you finishing and it replying, because
 * from the outside that gap is all one thing. A conversation over WebRTC is not like that — it
 * streams, so the gap is usually nothing at all — and what genuinely takes time is a tool call:
 * asking Home Assistant what the lights are doing, or the calendar what tomorrow looks like. That
 * is the wait worth showing, and it is the only one this reports.
 *
 * The handlers go to `startSession`, which takes them for the life of the session.
 */
export function useToolActivity() {
  const [inFlight, setInFlight] = useState<ToolCallsInFlight>(NOTHING_IN_FLIGHT);
  /**
   * Whether he is still finishing a thought whose last call has already answered.
   *
   * Separate from `inFlight` rather than folded into it, because they answer different
   * questions and only one of them is a fact: `inFlight` is what is actually running, which the
   * handlers below must keep exact, and this is a presentation decision about how the sphere
   * leaves that state. A fake id parked in the list to hold the drawing would corrupt the first
   * to serve the second.
   */
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (inFlight.length > 0) {
      // A new call inside the window continues the thought rather than starting a second one:
      // the timer below is cleaned up on the way out of this effect, so nothing is left armed
      // to end a thought that is running again.
      setSettling(true);
      return;
    }
    if (!settling) {
      return;
    }
    const finished = setTimeout(() => setSettling(false), KEEP_THINKING_AFTER_LAST_ANSWER_MS);
    return () => clearTimeout(finished);
  }, [inFlight, settling]);

  const toolHandlers = useMemo(
    () => ({
      onAgentToolRequest: ({ tool_call_id: id }: ToolCall) => setInFlight((running) => toolCallStarted(running, id)),
      onAgentToolResponse: ({ tool_call_id: id }: ToolCall) => setInFlight((running) => toolCallFinished(running, id)),
      // One event with a state on it, rather than a request and a response.
      onMCPToolCall: ({ tool_call_id: id, state }: MCPToolCall) =>
        setInFlight((running) =>
          state === STILL_RUNNING ? toolCallStarted(running, id) : toolCallFinished(running, id),
        ),
    }),
    [],
  );

  /**
   * Forget everything, for when the conversation ends.
   *
   * A call that was running when the session dropped never gets its answer, so without this the
   * sphere would be left mid-thought — and the next conversation would open with him already
   * thinking about something that is no longer happening.
   *
   * It clears the settling window too, and immediately. That window exists to bridge the gap
   * between one tool call and the next in the *same* request, and a conversation that has ended
   * has no next call: holding the thinking state open for two more seconds there would delay
   * him leaving rather than smooth anything over.
   */
  const forgetToolCalls = useCallback(() => {
    setInFlight(NOTHING_IN_FLIGHT);
    setSettling(false);
  }, []);

  return { thinking: inFlight.length > 0 || settling, toolHandlers, forgetToolCalls };
}
