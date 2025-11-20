import type { MessageInput } from '@mastra/core/agent/message-list';
import { z } from 'zod';
import { createStep, createWorkflow } from '../../utils/workflow-factory.js';
import { assignCopilotToIssue, createGitHubIssue, updateGitHubIssue } from './tools.js';

// Schema for requirements gathering input
const requirementsInputSchema = z.object({
    initialRequest: z.string().describe('The initial feature/implementation request from the user'),
    repository: z
        .string()
        .optional()
        .describe('The repository name (defaults to "hey-jarvis")'),
    owner: z.string().optional().describe('The repository owner (defaults to "ffMathy")'),
});

// Schema for gathered requirements
const gatheredRequirementsSchema = z.object({
    title: z.string().describe('Clear, concise feature title'),
    requirements: z.array(z.string()).describe('List of specific requirements gathered from the user'),
    acceptanceCriteria: z.array(z.string()).describe('List of acceptance criteria for the feature'),
    implementation: z
        .object({
            location: z.string().describe('Where in the codebase this should be implemented'),
            dependencies: z.array(z.string()).describe('Required dependencies or integrations'),
            edgeCases: z.array(z.string()).describe('Edge cases to consider'),
        })
        .describe('Implementation details'),
    questionsAsked: z.array(z.string()).describe('List of questions asked during requirements gathering'),
    isComplete: z.boolean().describe('Whether all requirements have been gathered'),
});

// Step 1a: Prepare draft issue data using workflow state
const prepareDraftIssueData = createStep({
    id: 'prepare-draft-issue-data',
    description: 'Prepares data for draft issue creation',
    inputSchema: requirementsInputSchema,
    outputSchema: z.object({
        owner: z.string().optional(),
        repo: z.string(),
        title: z.string(),
        body: z.string(),
        labels: z.array(z.string()).optional(),
    }),
    execute: async ({ context, workflow }) => {
        const owner = context.owner || 'ffMathy';
        const repo = context.repository || 'hey-jarvis';

        // Store initial request in workflow state
        workflow.setState({
            initialRequest: context.initialRequest,
            repository: repo,
            owner,
        });

        return {
            owner,
            repo,
            title: `[DRAFT] ${context.initialRequest.substring(0, 100)}`,
            body: `## Initial Request
${context.initialRequest}

## Requirements
_To be gathered..._

## Acceptance Criteria
_To be defined..._

## Discussion
_Requirements gathering in progress..._`,
            labels: ['draft', 'requirements-gathering'],
        };
    },
});

// Step 1b: Create draft issue using tool
const createDraftIssueTool = createStep({
    id: 'create-draft-issue-tool',
    description: 'Creates a draft GitHub issue using the GitHub API',
    inputSchema: z.object({
        owner: z.string().optional(),
        repo: z.string(),
        title: z.string(),
        body: z.string(),
        labels: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        issue_number: z.number().optional(),
        issue_url: z.string().optional(),
    }),
    execute: async ({ context, mastra }) => {
        return await createGitHubIssue.execute(context, mastra);
    },
});

// Step 1c: Store issue details in workflow state
const storeDraftIssueDetails = createStep({
    id: 'store-draft-issue-details',
    description: 'Stores the created issue details in workflow state',
    inputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        issue_number: z.number().optional(),
        issue_url: z.string().optional(),
    }),
    outputSchema: z.object({}),
    execute: async ({ context, workflow }) => {
        if (!context.success || !context.issue_number || !context.issue_url) {
            throw new Error(`Failed to create draft issue: ${context.message}`);
        }

        // Store issue details in workflow state
        workflow.setState({
            ...workflow.state,
            issueNumber: context.issue_number,
            issueUrl: context.issue_url,
        });
        return {};
    },
});

// Schema for iterative questioning response
const questioningResponseSchema = z.object({
    needsMoreQuestions: z.boolean().describe('Whether more questions need to be asked'),
    nextQuestion: z.string().nullable().describe('The next question to ask, or null if complete'),
    requirements: gatheredRequirementsSchema.describe('Current state of gathered requirements'),
});

// Step 2a: Initialize requirements gathering session using workflow state
const initializeGatheringSession = createStep({
    id: 'initialize-gathering-session',
    description: 'Sets up the initial prompt for requirements gathering',
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async ({ workflow }) => {
        const state = workflow.state;
        const initialPrompt = `You are conducting a requirements gathering session for this feature request:

"${state.initialRequest}"

Draft issue created: ${state.issueUrl}

Start by asking your first clarifying question to understand what needs to be implemented.`;

        workflow.setState({
            ...state,
            conversationHistory: [{ role: 'user', content: initialPrompt }],
            response: null,
        });

        return {};
    },
});

// Step 2b: Ask a single question in the requirements gathering loop using workflow state
const askRequirementsQuestion = createStep({
    id: 'ask-requirements-question',
    description: 'Asks a single clarifying question using the Requirements Interviewer Agent',
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    resumeSchema: z.object({
        userAnswer: z.string().describe("The user's answer to the question"),
    }),
    suspendSchema: z.object({
        question: z.string().describe('The question being asked to the user'),
        context: z.string().describe("Context about what we're trying to gather"),
    }),
    execute: async ({ mastra, workflow }) => {
        const agent = mastra?.getAgent('requirementsInterviewer');
        if (!agent) {
            throw new Error('Requirements Interviewer agent not found');
        }

        const state = workflow.state;

        // If we have resume data, add the user's answer to conversation history
        let conversationHistory = state.conversationHistory;
        if (workflow.resumeData?.userAnswer) {
            conversationHistory = [
                ...conversationHistory,
                {
                    role: 'user',
                    content: workflow.resumeData.userAnswer,
                },
            ];
        }

        // Get agent response with structured output
        const response = await agent.stream(conversationHistory as MessageInput[], {
            structuredOutput: {
                schema: questioningResponseSchema,
            },
        });

        const currentResponse = await response.object;

        if (!currentResponse) {
            throw new Error('Agent failed to provide a valid response');
        }

        // Add agent response to history
        const updatedHistory = [
            ...conversationHistory,
            {
                role: 'assistant',
                content: JSON.stringify(currentResponse),
            } as MessageInput,
        ];

        // Update workflow state with latest conversation and response
        workflow.setState({
            ...state,
            conversationHistory: updatedHistory,
            response: currentResponse,
        });

        // If more questions needed, suspend the workflow to wait for human input
        if (currentResponse.needsMoreQuestions) {
            if (!currentResponse.nextQuestion) {
                throw new Error('Agent indicated more questions needed but did not provide a question');
            }

            // Suspend the workflow with context for the UI
            return await workflow.suspend({
                question: currentResponse.nextQuestion,
                context: 'Requirements gathering in progress. Please provide your answer to continue.',
            });
        }

        return {};
    },
});

// Step 2c: Prepare draft issue update data using workflow state
const prepareDraftIssueUpdateData = createStep({
    id: 'prepare-draft-issue-update-data',
    description: 'Prepares data for updating draft issue with current progress',
    inputSchema: z.object({}),
    outputSchema: z.object({
        owner: z.string().optional(),
        repo: z.string(),
        issue_number: z.number(),
        body: z.string().optional(),
    }),
    execute: async ({ workflow }) => {
        const state = workflow.state;
        const { requirements } = state.response;

        // Format current requirements as markdown
        const requirementsSection =
            requirements.requirements.length > 0
                ? requirements.requirements.map((req) => `- ${req}`).join('\n')
                : '_Gathering..._';

        const acceptanceCriteriaSection =
            requirements.acceptanceCriteria.length > 0
                ? requirements.acceptanceCriteria.map((ac) => `- [ ] ${ac}`).join('\n')
                : '_To be defined..._';

        const implementationSection = `
**Location**: ${requirements.implementation.location || '_To be determined..._'}

**Dependencies**:
${requirements.implementation.dependencies.length > 0 ? requirements.implementation.dependencies.map((dep) => `- ${dep}`).join('\n') : '- _None identified yet_'}

**Edge Cases**:
${requirements.implementation.edgeCases.length > 0 ? requirements.implementation.edgeCases.map((edge) => `- ${edge}`).join('\n') : '- _None identified yet_'}
`;

        const discussionSection =
            requirements.questionsAsked.length > 0
                ? requirements.questionsAsked.map((q, idx) => `**Q${idx + 1}**: ${q}`).join('\n\n')
                : '_No questions asked yet..._';

        const status = requirements.isComplete ? '✅ Complete' : '🔄 In Progress';

        const progressBody = `## Status: ${status}

## Initial Request
${state.initialRequest}

## Requirements
${requirementsSection}

## Acceptance Criteria
${acceptanceCriteriaSection}

## Implementation Details
${implementationSection}

## Discussion History
${discussionSection}
`;

        return {
            owner: state.owner,
            repo: state.repository,
            issue_number: state.issueNumber,
            body: progressBody,
        };
    },
});

// Step 2d: Update draft issue with progress using tool
const updateDraftIssueProgressTool = createStep({
    id: 'update-draft-issue-progress-tool',
    description: 'Updates the draft issue with progress using the GitHub API',
    inputSchema: z.object({
        owner: z.string().optional(),
        repo: z.string(),
        issue_number: z.number(),
        body: z.string().optional(),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        issue_number: z.number().optional(),
        issue_url: z.string().optional(),
    }),
    execute: async ({ context, mastra }) => {
        return await updateGitHubIssue.execute(context, mastra);
    },
});

// Step 3a: Prepare final issue update data using workflow state
const prepareFinalIssueUpdateData = createStep({
    id: 'prepare-final-issue-update-data',
    description: 'Prepares data for final issue update with complete requirements',
    inputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        issue_number: z.number().optional(),
        issue_url: z.string().optional(),
    }),
    outputSchema: z.object({
        owner: z.string().optional(),
        repo: z.string(),
        issue_number: z.number(),
        title: z.string().optional(),
        body: z.string().optional(),
        labels: z.array(z.string()).optional(),
        state: z.enum(['open', 'closed']).optional(),
    }),
    execute: async ({ workflow }) => {
        const state = workflow.state;
        const { requirements } = state.response;

        // Format requirements as markdown
        const requirementsSection = requirements.requirements.map((req) => `- ${req}`).join('\n');
        const acceptanceCriteriaSection = requirements.acceptanceCriteria.map((ac) => `- [ ] ${ac}`).join('\n');
        const implementationSection = `
**Location**: ${requirements.implementation.location}

**Dependencies**:
${requirements.implementation.dependencies.map((dep) => `- ${dep}`).join('\n') || '- None'}

**Edge Cases**:
${requirements.implementation.edgeCases.map((edge) => `- ${edge}`).join('\n') || '- None'}
`;

        const discussionSection = requirements.questionsAsked
            .map((q, idx) => `**Q${idx + 1}**: ${q}`)
            .join('\n\n');

        const finalBody = `## Requirements
${requirementsSection}

## Acceptance Criteria
${acceptanceCriteriaSection}

## Implementation Details
${implementationSection}

## Discussion History
${discussionSection}
`;

        return {
            owner: state.owner,
            repo: state.repository,
            issue_number: state.issueNumber,
            title: requirements.title,
            body: finalBody,
            labels: ['ready', 'requirements-complete'],
            state: 'open' as const,
        };
    },
});

// Step 3b: Update issue with final requirements using tool
const updateIssueWithRequirementsTool = createStep({
    id: 'update-issue-with-requirements-tool',
    description: 'Updates the issue with final requirements using the GitHub API',
    inputSchema: z.object({
        owner: z.string().optional(),
        repo: z.string(),
        issue_number: z.number(),
        title: z.string().optional(),
        body: z.string().optional(),
        labels: z.array(z.string()).optional(),
        state: z.enum(['open', 'closed']).optional(),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        issue_number: z.number().optional(),
        issue_url: z.string().optional(),
    }),
    execute: async ({ context, mastra }) => {
        return await updateGitHubIssue.execute(context, mastra);
    },
});

// Step 3c: Store update result in workflow state
const storeFinalUpdateResult = createStep({
    id: 'store-final-update-result',
    description: 'Stores the final update result in workflow state',
    inputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        issue_number: z.number().optional(),
        issue_url: z.string().optional(),
    }),
    outputSchema: z.object({}),
    execute: async ({ context, workflow }) => {
        const state = workflow.state;
        workflow.setState({
            ...state,
            success: context.success,
            message: context.message,
        });
        return {};
    },
});

// Step 4a: Validate success before Copilot assignment
const validateBeforeCopilotAssignment = createStep({
    id: 'validate-before-copilot-assignment',
    description: 'Validates that issue update succeeded before assigning Copilot',
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async ({ workflow }) => {
        const state = workflow.state;

        if (!state.success) {
            throw new Error('Cannot assign to Copilot: Issue update failed');
        }

        return {};
    },
});

// Step 4b: Prepare Copilot assignment data using workflow state
const prepareCopilotAssignmentData = createStep({
    id: 'prepare-copilot-assignment-data',
    description: 'Prepares data for assigning issue to GitHub Copilot',
    inputSchema: z.object({}),
    outputSchema: z.object({
        owner: z.string().optional(),
        repo: z.string(),
        issue_number: z.number(),
    }),
    execute: async ({ workflow }) => {
        const state = workflow.state;

        return {
            owner: state.owner,
            repo: state.repository,
            issue_number: state.issueNumber,
        };
    },
});

// Step 4c: Assign to GitHub Copilot using tool
const assignToCopilotTool = createStep({
    id: 'assign-to-copilot-tool',
    description: 'Assigns the issue to GitHub Copilot using the GitHub API',
    inputSchema: z.object({
        owner: z.string().optional(),
        repo: z.string(),
        issue_number: z.number(),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        task_url: z.string().optional(),
    }),
    execute: async ({ context, mastra }) => {
        return await assignCopilotToIssue.execute(context, mastra);
    },
});

// Step 4d: Format final workflow output
const formatFinalOutput = createStep({
    id: 'format-final-output',
    description: 'Formats the final workflow output with success message',
    inputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        task_url: z.string().optional(),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        issueUrl: z.string().optional(),
    }),
    execute: async ({ context, workflow }) => {
        const state = workflow.state;

        if (!context.success) {
            return {
                success: false,
                message: `Copilot assignment initiated but may require manual confirmation: ${context.message}`,
                issueUrl: state.issueUrl,
            };
        }

        return {
            success: true,
            message: `Successfully assigned Copilot to issue #${state.issueNumber}. ${context.message}`,
            issueUrl: state.issueUrl,
        };
    },
});

/**
 * Workflow for gathering requirements and creating implementation issues
 *
 * This workflow implements the requirements gathering pattern using workflow state:
 * 1. Prepares and creates a draft issue to track progress (3 sub-steps)
 * 2. Initializes the requirements gathering session
 * 3. Uses Mastra's .dowhile() to iteratively:
 *    a. Ask clarifying questions via Requirements Interviewer Agent
 * 4. Prepares and updates the draft issue with current progress (2 sub-steps)
 * 5. Prepares and updates the issue with final requirements (3 sub-steps)
 * 6. Prepares and assigns GitHub Copilot for implementation (3 sub-steps)
 *
 * All state is managed via workflow.state and workflow.setState for cleaner code.
 * Tool calls are isolated in dedicated createToolStep steps for better observability.
 */
export const requirementsGatheringWorkflow = createWorkflow({
    id: 'requirements-gathering-workflow',
    inputSchema: requirementsInputSchema,
    outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        issueUrl: z.string().optional(),
    }),
})
    .then(prepareDraftIssueData)
    .then(createDraftIssueTool)
    .then(storeDraftIssueDetails)
    .then(initializeGatheringSession)
    .dowhile(
        askRequirementsQuestion,
        async ({ iterationCount }) => {
            // Safety limit check
            if (iterationCount >= 50) {
                throw new Error('Requirements gathering exceeded maximum iterations');
            }

            // Note: We can't access workflow.state in dowhile condition
            // The loop will naturally exit when suspend() is not called
            // which happens when needsMoreQuestions is false
            return true;
        },
    )
    .then(prepareDraftIssueUpdateData)
    .then(updateDraftIssueProgressTool)
    .then(prepareFinalIssueUpdateData)
    .then(updateIssueWithRequirementsTool)
    .then(storeFinalUpdateResult)
    .then(validateBeforeCopilotAssignment)
    .then(prepareCopilotAssignmentData)
    .then(assignToCopilotTool)
    .then(formatFinalOutput)
    .commit();
