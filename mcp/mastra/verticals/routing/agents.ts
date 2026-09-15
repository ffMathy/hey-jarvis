import type { Agent } from '@mastra/core/agent';
import { createMemory } from '../../memory/index.js';
import { createAgent } from '../../utils/index.js';
import { logger } from '../../utils/logger.js';
import { getPublicAgents } from '..';

const SUPERVISOR_INSTRUCTIONS = `You are the router for the Hey Jarvis assistant. A request arrives that needs work from the specialized agents available to you, and your job is to get all of it done and report back.

You do not answer from your own knowledge. Everything the user is asking about — the weather, the calendar, the house, the shopping list, recipes, email, the commute — is known only to the agents. If you answer without delegating, you are guessing.

# Delegation strategy
1. Work out which parts of the request need which agent, from the descriptions and capabilities you were given
2. Delegate every part that some agent can cover, and delegate parts that do not depend on each other at the same time rather than one after another
3. When one part needs a value another produces — a location before a weather lookup, a recipe before a shopping list — delegate the first, wait for it, and pass its result into the second
4. Give each agent a self-contained instruction. It cannot see the user's original request, this conversation, or what any other agent returned, so anything it needs must be in the prompt you send it

# Critical rules
- Only delegate work to an agent whose stated capabilities cover it
- If no agent can handle part of the request, leave it out rather than misassigning it, and say so at the end
- Do not invent work the user did not ask for, and do not look up a value the user already gave you
- Never ask clarifying questions — make best-guess assumptions and proceed
- An agent that fails is not the end of the request: carry on with the rest, and report what could not be found out

# Finishing
You are done when every part of the request that some agent can handle has been covered. Close with a plain summary of what was found, in your own words — never a task id, a tool name, or a raw response.`;

export { SUPERVISOR_INSTRUCTIONS };

/**
 * The id the supervisor is registered under on the Mastra instance.
 *
 * Shared so the controller can ask for the registered agent by the same name it was
 * registered with, rather than the two drifting apart.
 */
export const ROUTING_SUPERVISOR_AGENT_ID = 'routing-supervisor';

/**
 * Relays a call unchanged, reporting whatever it throws on the way past.
 *
 * A rejected promise is reported without being awaited, and a synchronous throw without
 * being made asynchronous, because some of these accessors resolve to a plain value and
 * turning that into a promise would change how Mastra reads them.
 */
function reportFrom<TArgs extends unknown[], TResult>(
  call: (...args: TArgs) => TResult,
  report: (error: unknown) => void,
): (...args: TArgs) => TResult {
  return (...args: TArgs): TResult => {
    try {
      const result = call(...args);
      if (result instanceof Promise) {
        result.catch(report);
      }
      return result;
    } catch (error) {
      report(error);
      throw error;
    }
  };
}

/**
 * Reports what a stream throws while it is being read, without changing what it yields.
 *
 * `stream` returns as soon as the run is under way, so a failure part-way through lands in
 * Mastra's own `for await` over `fullStream` rather than in the call this vertical wrapped.
 * That is where the delegation failures have to be: the agents here are the exact objects
 * the delegation tool runs -- `listAgents` hands back the configured map itself, so the
 * wrapper is installed -- and it has never once fired.
 *
 * The stream is teed rather than rebuilt. One branch goes to Mastra untouched, the other is
 * drained here only to see how it ends; `tee` keeps the type, so shadowing the read-only
 * `fullStream` getter with an own property needs no cast and no foreign stream
 * implementation. Draining eagerly is also what stops the tee buffering.
 */
function reportStreamErrors<
  TStream extends {
    tee(): [TStream, TStream];
    getReader(): { read(): Promise<{ done: boolean }>; releaseLock(): void };
  },
>(result: { fullStream: TStream }, report: (error: unknown) => void): void {
  const [forMastra, forUs] = result.fullStream.tee();
  Object.defineProperty(result, 'fullStream', { value: forMastra, configurable: true });

  void (async () => {
    const reader = forUs.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) {
          return;
        }
      }
    } catch (error) {
      report(error);
    } finally {
      reader.releaseLock();
    }
  })();
}

/**
 * Makes a subagent say why it failed, on its way out.
 *
 * Mastra catches whatever `stream` throws and re-throws a `MastraError` reading
 * `[Agent:RoutingSupervisor] - Failed agent tool execution for calendar`, keeping the real
 * error only as that wrapper's `cause`. Every route the cause could take out of the process
 * is closed: the session flattens the thrown error to its top-level message before emitting
 * `tool_end`, and the wrapper goes to `logger.trackException`, which reports to the
 * observability adapter rather than the log. A live run failed all five delegations and
 * named the agents five times without once saying what went wrong.
 *
 * So the reason is taken before any of that happens, from the one call this vertical owns.
 * These agents are already mutated here to swap their memory; this rides along with that.
 * The error is re-thrown untouched, so the supervisor still sees the failure it would have.
 *
 * This covers a run that fails on its way up, which is what the evidence points at: the
 * delegations fail within milliseconds of each other and leave no span behind, so whatever
 * goes wrong goes wrong before there is a run to trace. It does *not* cover a failure part
 * way through a stream that started cleanly -- `stream` returns as soon as the run is under
 * way and Mastra consumes `fullStream` itself, so that throw lands in its loop. Wrapping
 * that too would mean replacing a read-only property, which needs a cast this project does
 * not allow.
 */
function reportFailuresOf(agent: Agent): void {
  const stream = agent.stream.bind(agent);
  const generate = agent.generate.bind(agent);

  const report = (error: unknown) => {
    logger.error('Subagent failed', { agentId: agent.id, error });
  };

  // Everything the delegation asks the agent before it runs it. A throw in any of these
  // never reaches `stream`, so none of it was covered by wrapping the run -- which is the
  // shape the evidence has: no span, because there is no run to trace, and nothing from the
  // wrappers, because the call they wrap is never made.
  agent.getModel = reportFrom(agent.getModel.bind(agent), report);
  agent.getDefaultOptions = reportFrom(agent.getDefaultOptions.bind(agent), report);
  agent.getInstructions = reportFrom(agent.getInstructions.bind(agent), report);
  agent.getMemory = reportFrom(agent.getMemory.bind(agent), report);

  agent.stream = async (...args: Parameters<typeof stream>) => {
    let result: Awaited<ReturnType<typeof stream>>;
    try {
      result = await stream(...args);
    } catch (error) {
      report(error);
      throw error;
    }

    reportStreamErrors(result, report);
    return result;
  };

  // Delegation takes the stream path for v2 models, which is every model here. `generate`
  // is covered anyway: a reason missed because the call went the other way costs another
  // round trip through a live voice request to find out.
  agent.generate = async (...args: Parameters<typeof generate>) => {
    try {
      return await generate(...args);
    } catch (error) {
      report(error);
      throw error;
    }
  };
}

/**
 * The agent that fulfils a routing request by delegating to the specialized agents.
 *
 * This replaces a planner that emitted a task DAG for a separate executor to run. The DAG
 * was deliberately explicit — inspectable and replayable in Studio rather than buried in a
 * tool-call loop — and giving that up is the cost of this change. What it buys is that
 * ordering, parallelism, dependency passing and failure handling are now the model's job
 * inside one loop, instead of ~1000 lines of wave scheduler, completion registry and
 * report bookkeeping maintained here.
 *
 * The agents are attached as subagents, so Mastra generates a delegation tool per agent
 * and the supervisor loop drives them. Progress is observed through the session's event
 * stream rather than through a DAG that this vertical owns; see
 * {@link ./controller.ts}.
 */
export async function getRoutingSupervisorAgent(): Promise<Agent> {
  const routableAgents = await getPublicAgents();
  // Lean on both sides: no semantic recall, no working memory. See below for why the
  // subagents get it, and {@link getRoutingSupervisorAgent}'s `memory` for why the
  // supervisor needs a memory at all.
  const leanMemory = await createMemory({ enableSemanticRecall: false, enableWorkingMemory: false });

  // Delegation runs a subagent *memory-backed*, which the path this replaced never did:
  // the DAG executor called `agent.generate([...])` with no memory option at all, so no
  // thread was created, nothing was embedded, and the agents' own Memory was inert. Mastra
  // builds a thread and resource per delegation instead, which switches on semantic recall
  // — a hosted `gemini-embedding-001` round trip per message — working memory, and vector
  // writes, on every single delegation.
  //
  // None of that is wanted here and all of it is in the way. The supervisor holds the
  // request; a subagent is asked one self-contained question and answers it, so there is
  // nothing across calls for it to recall. What the embedder does buy is latency, on the
  // one path in this repo that cannot afford any: the poll deadline is 5s against
  // ElevenLabs' 8s cascade timeout. The synapse vertical already made this same trade for
  // the same reason.
  for (const agent of routableAgents) {
    agent.__setMemory(leanMemory);
    reportFailuresOf(agent);
  }

  const supervisor = await createAgent({
    id: ROUTING_SUPERVISOR_AGENT_ID,
    name: 'RoutingSupervisor',
    description: 'Fulfils a user request by delegating each part of it to the specialized agents.',
    instructions: SUPERVISOR_INSTRUCTIONS,
    agents: Object.fromEntries(routableAgents.map((agent) => [agent.id, agent])),
    // An AgentController session is thread-backed -- it maps to a Mastra thread, and that
    // is where `sendMessage` writes the turn it is about to run. An agent with no memory
    // gives it no thread to write into, and the run never happens: no events reach the
    // session, so nothing is delegated, nothing fails, and every poll reports a request
    // that is still going. `memory: undefined` here is what made routing hang.
    //
    // It is the same omission that made the first attempt at finding the delegations fail.
    // A background task records the resourceId of the run's memory scope, and a run with no
    // memory has no scope, so every row was written with `resourceId` undefined.
    //
    // Semantic recall and working memory stay off, for the reason the subagents have them
    // off: this is the latency-critical path, and the supervisor has nothing worth recalling
    // across requests anyway -- it holds one request at a time and the thread is the
    // session's, not a memory of past calls.
    memory: leanMemory,
    // Delegations are *not* dispatched as background tasks. `backgroundTasks: { tools: 'all' }`
    // was tried and did nothing: a live run announced three delegations and the task manager
    // held no rows for any of them, so they ran in the supervisor's own turn regardless.
    // The session's event stream reports them completely -- `tool_start` opening each one and
    // `tool_end` carrying its answer -- so that is what the poll reads.
  });

  return supervisor;
}
