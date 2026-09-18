import type { DynamicWorkflowGraph } from '@mastra/core/workflows';
import { routingPlanMetadata } from './plan-retention.js';

/**
 * A routing request, expressed as a workflow Mastra builds at runtime.
 *
 * Routing used to be a supervisor agent delegating inside one tool-call loop. That loop is
 * opaque: Studio graphs workflows, so a request drawn as a picture needs the request to *be*
 * a workflow -- and which agents a request needs is known only once it arrives, so the
 * workflow has to be built per request. That is what this file emits, and it is the whole
 * reason routing is shaped this way.
 *
 * The graph vocabulary below is not a style choice. Each rule was learned from a rejection,
 * and `plan.spec.ts` pins all of them.
 */

/**
 * What an agent step takes and gives back.
 *
 * Not a choice: `createStepFromAgent` hands every agent step `z.object({ prompt: z.string() })`
 * in and `z.object({ text: z.string() })` out. A first attempt declared the workflow input as
 * `{ userQuery }` and was rejected before it ran -- `[incompatible-schema] graph.0.steps.0:
 * Step input is incompatible with the preceding workflow output`.
 */
const AGENT_STEP_INPUT = { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } as const;
const AGENT_STEP_OUTPUT = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } as const;

/** One thing a plan asks of one agent. */
export interface PlannedDelegation {
  /**
   * The planner's own name for this piece of work.
   *
   * Carried through because it is the only identifier a delegation has that is unique within
   * a plan. The agent id is not: one request can ask the calendar two different questions,
   * and reporting both as "calendar" makes the poll loop contradict itself -- one of them
   * finishing while "calendar" is still listed as outstanding for the other.
   */
  taskId: string;
  agentId: string;
  prompt: string;
}

/**
 * Delegations that have to happen in order, because each needs the one before it.
 *
 * A chain is the plan's only sequencing primitive, and dependency passing falls out of it:
 * every step after the first is handed the previous answer along with its own prompt. The
 * user asking for the weather "where I am" is one chain of two -- find the location, then
 * ask about the weather there -- while the weather and the calendar are two chains of one,
 * run at the same time.
 */
export interface PlannedChain {
  delegations: PlannedDelegation[];
}

/** A plan, built and ready to register. */
export interface RoutingPlan {
  /** The id of the root workflow, and the tag every member carries. */
  id: string;
  /** The root last, because a bundle is registered together and read in order. */
  graphs: DynamicWorkflowGraph[];
  /** Which agent each agent step runs, so a step result can be reported as a delegation. */
  agentByStepId: ReadonlyMap<string, string>;
  /** Which task each agent step came from, which is what a delegation is reported as. */
  taskIdByStepId: ReadonlyMap<string, string>;
  /**
   * The agent steps each chain contains, in order, keyed by the chain's call-site step id.
   *
   * A chain reports a result of its own -- its last step's answer -- so this is what lets
   * that result be attributed even if the chain's own steps never reach the parent stream.
   */
  delegationIdsByChainStepId: ReadonlyMap<string, string[]>;
  /** How many delegations the plan contains. */
  delegationCount: number;
}

/**
 * Keeps a planner-written prompt out of the template parser.
 *
 * A chained prompt is carried by a `{ template }` mapping, and `${` starts a placeholder
 * there. A prompt that happens to contain one -- a shell snippet, a price, anything the user
 * quoted -- would be rejected as an unknown namespace at registration time, failing the
 * whole request over a character in someone's sentence.
 */
function withoutTemplatePlaceholders(prompt: string): string {
  // `split`/`join` rather than `replaceAll`, which this project's TypeScript target
  // does not have.
  return prompt.split('${').join('$ {');
}

/**
 * What a chained delegation is told about the answer it follows.
 *
 * An agent cannot see the request, the plan, or what any other agent said, so the previous
 * answer has to arrive in the prompt or not at all.
 *
 * **Including when there isn't one.** A step ahead of this one can finish having said nothing — cut
 * off mid-tool-loop, or abandoned because the plan settled before it reported, both of which this
 * run did — and what lands here is then an empty string under a heading calling it a result to use.
 * A model handed that does the helpful thing and fills the gap: asked to put the ingredients of a
 * recipe on a to-do list when no recipe ever arrived, it wrote a perfectly plausible lasagna. The
 * eval caught it, and it is worth catching, because these steps have side effects. A wrong answer
 * spoken aloud is corrected in the next sentence; a wrong answer written to a to-do list is still
 * there next week.
 *
 * The warning is unconditional because it has to be: the prompt is templated when the plan is
 * built, which is before any step has run, so there is no moment at which this could be written
 * only for the runs that need it.
 */
const PREVIOUS_ANSWER_HEADING =
  'Here is the result of the previous step, which you should use to answer. If it is empty, or says ' +
  'it did not answer or could not be completed, then that information does not exist: do not invent, ' +
  'guess or substitute it, not even something reasonable. Say plainly what you could not do and why, ' +
  'and record nothing.';

/**
 * One chain: give an agent its prompt, run it, and repeat with the answer in hand.
 *
 * A workflow of its own rather than entries in the parallel block, because a `mapping` entry
 * has to be a top-level workflow entry -- one inside a `parallel` is rejected with
 * `[invalid-map-placement]`. Since a plan's whole point is asking each agent a *different*
 * question, per-chain prompts mean per-chain workflows.
 *
 * `mapConfig` is a JSON string rather than an object: it is parsed by `parseMapConfig` on the
 * way in, and an object is rejected with `[invalid-map-config]`.
 *
 * The first prompt is a constant, later ones a template over `inputData` -- which at that
 * point is the preceding agent step's `{ text }`. `inputData` rather than
 * `stepResults.<id>` because it needs no step id and so cannot drift out of scope.
 */
function chainWorkflow(
  planId: string,
  chainIndex: number,
  chain: PlannedChain,
  agentByStepId: Map<string, string>,
  taskIdByStepId: Map<string, string>,
  stepIds: string[],
): DynamicWorkflowGraph {
  const id = `${planId}-chain-${chainIndex}`;
  const graph: DynamicWorkflowGraph['graph'] = [];

  chain.delegations.forEach((delegation, index) => {
    const prompt = withoutTemplatePlaceholders(delegation.prompt);
    const mapConfig =
      index === 0
        ? { prompt: { value: prompt, schema: { type: 'string' } } }
        : { prompt: { template: `${prompt}\n\n${PREVIOUS_ANSWER_HEADING}\n\${inputData.text}` } };

    const stepId = `${id}-${index}-${delegation.agentId}`;
    agentByStepId.set(stepId, delegation.agentId);
    taskIdByStepId.set(stepId, delegation.taskId);
    stepIds.push(stepId);

    graph.push({ type: 'mapping', id: `${stepId}-prompt`, mapConfig: JSON.stringify(mapConfig) });
    graph.push({ type: 'agent', id: stepId, agentId: delegation.agentId });
  });

  return {
    id,
    description: chain.delegations.map((delegation) => delegation.agentId).join(' then '),
    metadata: routingPlanMetadata(planId),
    inputSchema: AGENT_STEP_INPUT,
    outputSchema: AGENT_STEP_OUTPUT,
    graph,
  };
}

/**
 * A plan as a bundle: one workflow per chain, and a root running the chains together.
 *
 * `addDynamicWorkflows` validates a bundle as a unit and registers nothing if any member is
 * rejected, so the root may reference chains that do not exist yet.
 *
 * The root takes `{ prompt }` like everything else here, and what it is given is the user's
 * own request -- nothing reads it, but it is what a run shows at the top in Studio, which is
 * the point of drawing this at all.
 */
export function buildRoutingPlan(planId: string, chains: PlannedChain[]): RoutingPlan {
  const agentByStepId = new Map<string, string>();
  const taskIdByStepId = new Map<string, string>();
  const delegationIdsByChainStepId = new Map<string, string[]>();

  const stepIdsByChain: string[][] = chains.map(() => []);
  const workflows = chains.map((chain, index) =>
    chainWorkflow(planId, index, chain, agentByStepId, taskIdByStepId, stepIdsByChain[index]),
  );

  const root: DynamicWorkflowGraph = {
    id: planId,
    description: 'A routing plan, built for one request',
    metadata: routingPlanMetadata(planId),
    inputSchema: AGENT_STEP_INPUT,
    outputSchema: { type: 'object' },
    graph: [
      {
        type: 'parallel',
        steps: workflows.map((workflow, index) => {
          const stepId = `chain-${index}`;
          delegationIdsByChainStepId.set(stepId, stepIdsByChain[index]);
          return { type: 'workflow' as const, id: stepId, workflowId: workflow.id };
        }),
      },
    ],
  };

  return {
    id: planId,
    graphs: [...workflows, root],
    agentByStepId,
    taskIdByStepId,
    delegationIdsByChainStepId,
    delegationCount: chains.reduce((count, chain) => count + chain.delegations.length, 0),
  };
}
