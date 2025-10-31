import { createWorkflow, createAgentStep, createStep } from '../../utils/workflow-factory';
import { z } from 'zod';

// Agent-as-step for scheduled weather check using the weather agent directly
const scheduledWeatherCheck = createAgentStep({
    id: 'scheduled-weather-check',
    description: 'Checks weather for Mathias every hour and notifies memory agent of changes',
    agentName: 'weather',
    inputSchema: z.object({}),
    outputSchema: z.object({
        memoryUpdate: z.object({
            context: z.string(),
            events: z.array(z.object({
                type: z.string(),
                information: z.any(),
            })),
        }).optional(),
    }),
    prompt: () => 'Get current weather for Mathias, Denmark',
});

// Transform weather data into memory update format
const transformToMemoryUpdate = createStep({
    id: 'transform-to-memory-update',
    description: 'Transform weather data into memory update format',
    inputSchema: z.object({
        result: z.string(), // This comes from the agent response
    }),
    outputSchema: z.object({
        memoryUpdate: z.object({
            context: z.string(),
            events: z.array(z.object({
                type: z.string(),
                information: z.any(),
            })),
        }).optional(),
    }),
    execute: async ({ context }) => {
        // Create memory update event (like the n8n ExecuteWorkflow node does)
        const memoryUpdate = {
            context: "The weather has changed.",
            events: [{
                type: "weather-changed",
                information: context.result
            }]
        };

        return {
            memoryUpdate,
        };
    },
});

// Scheduled weather monitoring workflow using agent-as-step pattern
export const weatherMonitoringWorkflow = createWorkflow({
    id: 'weather-monitoring-workflow',
    inputSchema: z.object({}),
    outputSchema: z.object({
        memoryUpdate: z.object({
            context: z.string(),
            events: z.array(z.object({
                type: z.string(),
                information: z.any(),
            })),
        }).optional(),
    }),
})
    .then(scheduledWeatherCheck)
    .then(transformToMemoryUpdate);

// Commit the workflows
weatherMonitoringWorkflow.commit();