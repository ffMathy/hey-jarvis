import { logger } from '../../utils/logger.js';
import type { PlannedChain } from './plan.js';

/**
 * Turning what the planner wrote into something that can actually be run.
 *
 * The planner used to emit chains directly, and that put the one thing it gets wrong most
 * often -- sequencing -- into its hands as a structural decision. It would write five tasks
 * as five chains and the request would run entirely in parallel, so a task whose whole job
 * was to use another's answer ran before that answer existed and invented one instead. A live
 * eval caught exactly that: a to-do reminder was filled with a generic lasagna ingredient
 * list while the recipe lookup it depended on was still running.
 *
 * So the planner no longer decides the shape. It writes a flat list of tasks and says, per
 * task, which other task's answer it cannot proceed without -- a local judgement about one
 * prompt, rather than a partition of the whole request into ordered buckets -- and the chains
 * are derived here, deterministically. A dependency the planner declares can no longer end up
 * running in parallel with the thing it depends on, because nothing downstream of this file
 * is free to place it there.
 *
 * What the planner can still get wrong is an edge: naming the wrong task, or naming none. No
 * amount of structure fixes that, and this file does not pretend to -- what it guarantees is
 * that a declared edge is honoured.
 */

/** One thing the planner asks of one agent, and what it has to be given first. */
export interface PlannedTask {
  id: string;
  agentId: string;
  prompt: string;
  /** The id of the task whose answer this one needs, or empty when it needs nothing. */
  needs: string;
}

/** A task once its id is known to be usable and its dependency known to be real. */
interface ResolvedTask {
  id: string;
  agentId: string;
  prompt: string;
  parentId: string | undefined;
  dependents: ResolvedTask[];
}

/**
 * Drops the tasks that cannot be run at all.
 *
 * A plan is registered as a bundle and validated as one, so a single task naming an agent
 * that does not exist takes the whole request down with it. A model that invents an id is a
 * thing that happens; losing the rest of the request over it need not be.
 */
function withKnownAgents(tasks: PlannedTask[], knownAgentIds: ReadonlySet<string>): PlannedTask[] {
  return tasks.filter((task) => {
    if (knownAgentIds.has(task.agentId)) {
      return true;
    }
    logger.warn('Routing plan named an agent that does not exist', { agentId: task.agentId });
    return false;
  });
}

/**
 * Gives every task an id nothing else is using.
 *
 * A blank or repeated id is the model's mistake, and the cheap answer would be to drop the
 * task. That answer is wrong: the task is a part of the request the user made, and a part
 * dropped is a question never asked. So it keeps its place and is given an id of our own
 * instead. The only thing it loses is the ability to be depended upon, which a task nobody
 * can name unambiguously had already lost.
 */
function withUsableIds(tasks: PlannedTask[]): PlannedTask[] {
  const declaredIds = new Set(tasks.map((task) => task.id.trim()).filter((id) => id.length > 0));
  const taken = new Set<string>();

  return tasks.map((task, index) => {
    const declared = task.id.trim();
    if (declared.length > 0 && !taken.has(declared)) {
      taken.add(declared);
      return { ...task, id: declared };
    }

    let substitute = `task-${index}`;
    for (let suffix = 0; declaredIds.has(substitute) || taken.has(substitute); suffix++) {
      substitute = `task-${index}-${suffix}`;
    }
    taken.add(substitute);

    logger.warn('Routing plan gave a task no usable id, so it can depend on others but none can depend on it', {
      declaredId: task.id,
      agentId: task.agentId,
      substitute,
    });
    return { ...task, id: substitute };
  });
}

/**
 * What a `needs` refers to, allowing for the ways a model names a thing it means.
 *
 * An edge is the expensive thing to lose -- losing one is the whole bug this file exists for
 * -- so a reference is read generously before it is given up on. Exact id first; then id
 * ignoring case, because a model that was told ids are lower-case will still write `Recipe`;
 * then the agent id, because the two names sit side by side in every task it writes and
 * naming the agent when it meant the task is the obvious confusion to make. The agent id
 * counts only when exactly one task uses that agent, since with two there is no way to tell
 * which was meant and a guess would be worse than no edge at all.
 */
function referencedTaskId(needs: string, tasks: PlannedTask[]): string | undefined {
  const exact = tasks.find((task) => task.id === needs);
  if (exact) {
    return exact.id;
  }

  const wanted = needs.toLowerCase();

  const sameId = tasks.filter((task) => task.id.toLowerCase() === wanted);
  if (sameId.length === 1) {
    return sameId[0].id;
  }

  const sameAgent = tasks.filter((task) => task.agentId.toLowerCase() === wanted);
  if (sameAgent.length === 1) {
    return sameAgent[0].id;
  }

  return undefined;
}

/**
 * The task this one is waiting on, once the reference is known to point somewhere.
 *
 * A `needs` naming a task that was dropped, or never existed, or is the task itself, is
 * treated as no dependency rather than as a reason to fail: the work still has to happen, and
 * running it unchained is what would have happened anyway before any of this existed.
 */
function declaredParentId(task: PlannedTask, tasks: PlannedTask[]): string | undefined {
  const needs = task.needs.trim();
  if (needs.length === 0) {
    return undefined;
  }

  const parentId = referencedTaskId(needs, tasks);
  if (parentId === undefined) {
    logger.warn('Routing plan made a task depend on one that is not in the plan', { taskId: task.id, needs });
    return undefined;
  }

  if (parentId === task.id) {
    logger.warn('Routing plan made a task depend on itself', { taskId: task.id });
    return undefined;
  }

  return parentId;
}

/**
 * Cuts one link out of every dependency cycle.
 *
 * A cycle cannot be run in any order, and it reaches here as a plain fact about strings
 * rather than as anything a later stage could notice -- the path walk below would simply not
 * terminate. Walking each task's ancestors and dropping the link of the first task that finds
 * its way back to itself leaves a forest, and leaves every task in the plan.
 */
function withoutCycles(parentIds: ReadonlyMap<string, string>): Map<string, string> {
  const safe = new Map(parentIds);

  for (const startId of parentIds.keys()) {
    const seen = new Set([startId]);
    let currentId = safe.get(startId);

    while (currentId !== undefined) {
      if (seen.has(currentId)) {
        logger.warn('Routing plan made a circular dependency, so one link was cut', { taskId: startId });
        safe.delete(startId);
        break;
      }
      seen.add(currentId);
      currentId = safe.get(currentId);
    }
  }

  return safe;
}

/**
 * Every root-to-leaf path through the forest, each of which becomes one chain.
 *
 * A chain carries one answer forward -- the step before it -- so a task needed by two others
 * appears in two paths, and is therefore run twice. That is the one place this trades
 * something away, and it is deliberate: a chain is the only sequencing the plan vocabulary in
 * `plan.ts` has, and of the two ways to express a fan-out with it, doing the shared work
 * twice costs time and quota while dropping one of the edges costs a wrong answer. The common
 * shapes -- a location before a weather lookup, a recipe before a reminder -- are paths, and
 * pay nothing for this.
 */
function pathsThrough(task: ResolvedTask): ResolvedTask[][] {
  if (task.dependents.length === 0) {
    return [[task]];
  }

  return task.dependents.flatMap((dependent) => pathsThrough(dependent).map((path) => [task, ...path]));
}

/**
 * The chains a plan of tasks runs as.
 *
 * Roots keep the order the planner listed them in, and so do the dependents of any one task,
 * so the same plan always produces the same chains in the same order. That matters for more
 * than tidiness: the chain index is part of every step id the plan registers.
 */
export function chainsFromTasks(tasks: PlannedTask[], knownAgentIds: ReadonlySet<string>): PlannedChain[] {
  const usable = withUsableIds(withKnownAgents(tasks, knownAgentIds));

  const declaredParentIds = new Map<string, string>();
  for (const task of usable) {
    const parentId = declaredParentId(task, usable);
    if (parentId !== undefined) {
      declaredParentIds.set(task.id, parentId);
    }
  }
  const parentIds = withoutCycles(declaredParentIds);

  const resolvedById = new Map<string, ResolvedTask>(
    usable.map((task) => [
      task.id,
      { id: task.id, agentId: task.agentId, prompt: task.prompt, parentId: parentIds.get(task.id), dependents: [] },
    ]),
  );

  const roots: ResolvedTask[] = [];
  for (const task of usable) {
    const resolved = resolvedById.get(task.id);
    if (!resolved) {
      continue;
    }

    const parent = resolved.parentId === undefined ? undefined : resolvedById.get(resolved.parentId);
    if (parent) {
      parent.dependents.push(resolved);
    } else {
      roots.push(resolved);
    }
  }

  const chains = roots
    .flatMap((root) => pathsThrough(root))
    .map((path) => ({
      delegations: path.map((task) => ({ agentId: task.agentId, prompt: task.prompt })),
    }));

  // The shape, never the prompts: a prompt is written from the user's request and would put
  // what they asked about into the log. Ids and agent ids are enough to answer the only
  // question this log exists for -- did the planner declare the edges, and did they survive --
  // which otherwise can only be guessed at from the order results happen to come back in.
  logger.info('Derived the chains a routing plan runs as', {
    declared: usable.map((task) => ({ id: task.id, agentId: task.agentId, needs: task.needs.trim() })),
    chains: chains.map((chain) => chain.delegations.map((delegation) => delegation.agentId)),
  });

  return chains;
}
