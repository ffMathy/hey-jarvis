import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KEEP_THINKING_AFTER_LAST_ANSWER_MS,
  MCP_TOOL_STILL_RUNNING,
  type MCPToolCallEvent,
  NOTHING_IN_FLIGHT,
  type ToolCallEvent,
  type ToolCallsInFlight,
  toolCallFinished,
  toolCallStarted,
} from '../tool-activity';

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
 *
 * The list, the rules for changing it and the settling window's length are the main entry's
 * (`../tool-activity.ts`), shared with `createToolActivity` there, which is the same state machine
 * for a client with no React. This one keeps its own in React state, as it always has.
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
      onAgentToolRequest: ({ tool_call_id: id }: ToolCallEvent) =>
        setInFlight((running) => toolCallStarted(running, id)),
      onAgentToolResponse: ({ tool_call_id: id }: ToolCallEvent) =>
        setInFlight((running) => toolCallFinished(running, id)),
      // One event with a state on it, rather than a request and a response.
      onMCPToolCall: ({ tool_call_id: id, state }: MCPToolCallEvent) =>
        setInFlight((running) =>
          state === MCP_TOOL_STILL_RUNNING ? toolCallStarted(running, id) : toolCallFinished(running, id),
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
