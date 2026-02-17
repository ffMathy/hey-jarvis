/**
 * Type utilities for working with Mastra workflows in a type-safe manner.
 *
 * These utilities extract and infer types from actual workflow definitions
 * rather than using simplified interfaces, ensuring better type inference
 * and consistency with the Mastra framework.
 */
import type { Run, Workflow } from '@mastra/core/workflows';
import type { ZodType } from 'zod';

/**
 * The minimal shape of a Mastra Workflow that we need for our use cases.
 *
 * Uses TypeScript's type inference to pick only the properties we need
 * from the actual Workflow class, ensuring type compatibility.
 *
 * Properties picked:
 * - id: Unique identifier for the workflow
 * - description: Optional human-readable description
 * - inputSchema: Zod schema for validating input
 * - outputSchema: Zod schema for output type
 * - createRun: Method to create a new workflow run instance
 *
 * @example
 * ```typescript
 * function executeWorkflow(workflow: AnyWorkflow) {
 *   const run = await workflow.createRun();
 *   return run.start({ inputData: {} });
 * }
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Workflow has 8 generic parameters that cannot be inferred without specific workflow instances
export type AnyWorkflow = Pick<
  Workflow<any, any, any, any, any, any, any, any>,
  'id' | 'description' | 'inputSchema' | 'outputSchema' | 'createRun'
>;

/**
 * The return type of createRun() for any workflow.
 *
 * Uses ReturnType to infer the Promise's resolved type.
 */
export type AnyWorkflowRun = Awaited<ReturnType<AnyWorkflow['createRun']>>;

/**
 * The result type from calling run.start() on a workflow run.
 *
 * Uses ReturnType to infer the Promise's resolved type from the Run class.
 */
// biome-ignore lint/suspicious/noExplicitAny: Run has 5 generic parameters that cannot be inferred without specific workflow instances
export type AnyWorkflowResult = Awaited<ReturnType<Run<any, any, any, any, any>['start']>>;

/**
 * Extended workflow type with optional name property for display purposes.
 *
 * This extends AnyWorkflow with an optional name that some workflows
 * may have for human-friendly display.
 */
export type NamedWorkflow = AnyWorkflow & {
  name?: string;
};

/**
 * Type guard to check if an object is a valid workflow-like structure.
 *
 * @param obj - Object to check
 * @returns True if obj has required workflow properties
 */
export function isWorkflowLike(obj: unknown): obj is AnyWorkflow {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const workflow = obj as Record<string, unknown>;

  return typeof workflow.id === 'string' && typeof workflow.createRun === 'function';
}

/**
 * Extracts the input type from a workflow's inputSchema.
 *
 * @example
 * ```typescript
 * type MyWorkflowInput = WorkflowInputType<typeof myWorkflow>;
 * ```
 */
export type WorkflowInputType<T extends AnyWorkflow> = T['inputSchema'] extends ZodType<infer U> ? U : unknown;

/**
 * Extracts the output type from a workflow's outputSchema.
 *
 * @example
 * ```typescript
 * type MyWorkflowOutput = WorkflowOutputType<typeof myWorkflow>;
 * ```
 */
export type WorkflowOutputType<T extends AnyWorkflow> = T['outputSchema'] extends ZodType<infer U> ? U : unknown;
