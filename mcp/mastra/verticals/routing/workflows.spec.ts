import {
    getNextInstructionsWorkflow,
    routePromptWorkflow,
    resetCurrentDAG,
    getCurrentDAG,
    injectTask,
    simulateTaskCompletion,
    setAgentProvider,
    resetAgentProvider,
    getTaskCompletedListenersCount,
    clearTaskCompletedListeners,
    type AgentProvider,
} from './workflows.js';
import { Agent } from '@mastra/core/agent';

function createMockAgent(id: string, description: string): Agent {
    const mockAgent = {
        id,
        name: id,
        getDescription: () => description,
        generate: jest.fn().mockResolvedValue({ text: `Mock response from ${id}` }),
    } as unknown as Agent;
    return mockAgent;
}

function assertWorkflowSuccess<T>(workflowResult: { status: string; result?: T }): T {
    expect(workflowResult.status).toBe('success');
    if (workflowResult.status !== 'success') {
        throw new Error(`Workflow failed with status: ${workflowResult.status}`);
    }
    return workflowResult.result as T;
}

describe('Routing Workflows', () => {
    beforeEach(() => {
        resetCurrentDAG();
        clearTaskCompletedListeners();
        resetAgentProvider();
    });

    afterEach(() => {
        resetCurrentDAG();
        clearTaskCompletedListeners();
        resetAgentProvider();
    });

    describe('getNextInstructionsWorkflow', () => {
        describe('timing behavior', () => {
            it('should wait for task completion when called before routePromptWorkflow', async () => {
                const mockAgent = createMockAgent('weather', 'Provides weather information');
                const mockAgentProvider: AgentProvider = async () => [mockAgent];
                setAgentProvider(mockAgentProvider);

                injectTask({
                    id: 'get-weather',
                    agent: 'weather',
                    prompt: 'Get weather for Aarhus',
                    dependsOn: [],
                });

                const instructionsPromise = getNextInstructionsWorkflow.createRun()
                    .then(run => run.start({ inputData: {} }));

                await new Promise(resolve => setTimeout(resolve, 100));

                const listenersAfterWait = getTaskCompletedListenersCount();
                expect(listenersAfterWait).toBe(1);

                simulateTaskCompletion('get-weather', 'Sunny, 22°C');

                const workflowResult = await instructionsPromise;
                const result = assertWorkflowSuccess(workflowResult);
                expect(result.instructions).toContain('All tasks have completed');
                expect(result.completedTaskResults).toHaveLength(1);
                expect(result.completedTaskResults?.[0].id).toBe('get-weather');
            });

            it('should properly handle listeners registered before any tasks exist', async () => {
                const mockAgent = createMockAgent('weather', 'Provides weather information');
                const mockAgentProvider: AgentProvider = async () => [mockAgent];
                setAgentProvider(mockAgentProvider);

                const instructionsPromise = getNextInstructionsWorkflow.createRun()
                    .then(run => run.start({ inputData: {} }));

                await new Promise(resolve => setTimeout(resolve, 50));

                const listenersBeforeTask = getTaskCompletedListenersCount();
                expect(listenersBeforeTask).toBe(1);

                injectTask({
                    id: 'get-weather',
                    agent: 'weather',
                    prompt: 'Get weather for Aarhus',
                    dependsOn: [],
                });

                simulateTaskCompletion('get-weather', 'Sunny, 22°C');

                const workflowResult = await instructionsPromise;
                const result = assertWorkflowSuccess(workflowResult);
                expect(result.instructions).toContain('All tasks have completed');
                expect(result.completedTaskResults).toHaveLength(1);
            });

            it('should timeout and return processing message after 15 seconds', async () => {
                const mockAgent = createMockAgent('weather', 'Provides weather information');
                const mockAgentProvider: AgentProvider = async () => [mockAgent];
                setAgentProvider(mockAgentProvider);

                const startTime = Date.now();
                const workflowResult = await getNextInstructionsWorkflow.createRun()
                    .then(run => run.start({ inputData: {} }));
                const elapsed = Date.now() - startTime;

                expect(elapsed).toBeGreaterThanOrEqual(14900);
                expect(elapsed).toBeLessThan(16000);
                const result = assertWorkflowSuccess(workflowResult);
                expect(result.instructions).toContain('Still processing');
            }, 20000);
        });

        describe('task reporting', () => {
            it('should report leaf tasks with their full results', async () => {
                const mockAgent = createMockAgent('weather', 'Provides weather information');
                const mockAgentProvider: AgentProvider = async () => [mockAgent];
                setAgentProvider(mockAgentProvider);

                injectTask({
                    id: 'get-weather',
                    agent: 'weather',
                    prompt: 'Get weather for Aarhus',
                    dependsOn: [],
                });

                const instructionsPromise = getNextInstructionsWorkflow.createRun()
                    .then(run => run.start({ inputData: {} }));

                await new Promise(resolve => setTimeout(resolve, 50));

                simulateTaskCompletion('get-weather', { temperature: 22, condition: 'Sunny' });

                const workflowResult = await instructionsPromise;
                const result = assertWorkflowSuccess(workflowResult);
                expect(result.completedTaskResults?.[0].result).toEqual({ temperature: 22, condition: 'Sunny' });
            });

            it('should not include results for non-leaf tasks', async () => {
                const mockAgent = createMockAgent('weather', 'Provides weather information');
                const mockAgentProvider: AgentProvider = async () => [mockAgent];
                setAgentProvider(mockAgentProvider);

                injectTask({
                    id: 'get-location',
                    agent: 'weather',
                    prompt: 'Get current location',
                    dependsOn: [],
                });
                injectTask({
                    id: 'get-weather',
                    agent: 'weather',
                    prompt: 'Get weather for location',
                    dependsOn: ['get-location'],
                });

                const instructionsPromise = getNextInstructionsWorkflow.createRun()
                    .then(run => run.start({ inputData: {} }));

                await new Promise(resolve => setTimeout(resolve, 50));

                simulateTaskCompletion('get-location', 'Aarhus, Denmark');

                const workflowResult = await instructionsPromise;
                const result = assertWorkflowSuccess(workflowResult);
                expect(result.completedTaskResults?.[0].id).toBe('get-location');
                expect(result.completedTaskResults?.[0].result).toBeUndefined();
                expect(result.instructions).toContain('not all tasks have completed');
            });

            it('should mark tasks as reported after returning them', async () => {
                const mockAgent = createMockAgent('weather', 'Provides weather information');
                const mockAgentProvider: AgentProvider = async () => [mockAgent];
                setAgentProvider(mockAgentProvider);

                injectTask({
                    id: 'task-1',
                    agent: 'weather',
                    prompt: 'Task 1',
                    dependsOn: [],
                });
                injectTask({
                    id: 'task-2',
                    agent: 'weather',
                    prompt: 'Task 2',
                    dependsOn: [],
                });

                const promise1 = getNextInstructionsWorkflow.createRun()
                    .then(run => run.start({ inputData: {} }));

                await new Promise(resolve => setTimeout(resolve, 50));
                simulateTaskCompletion('task-1', 'Result 1');

                const workflowResult1 = await promise1;
                const result1 = assertWorkflowSuccess(workflowResult1);
                expect(result1.completedTaskResults).toHaveLength(1);
                expect(result1.completedTaskResults?.[0].id).toBe('task-1');

                const promise2 = getNextInstructionsWorkflow.createRun()
                    .then(run => run.start({ inputData: {} }));

                await new Promise(resolve => setTimeout(resolve, 50));
                simulateTaskCompletion('task-2', 'Result 2');

                const workflowResult2 = await promise2;
                const result2 = assertWorkflowSuccess(workflowResult2);
                expect(result2.completedTaskResults).toHaveLength(1);
                expect(result2.completedTaskResults?.[0].id).toBe('task-2');
            });
        });

        describe('DAG reset behavior', () => {
            it('should reset DAG when all tasks are completed', async () => {
                const mockAgent = createMockAgent('weather', 'Provides weather information');
                const mockAgentProvider: AgentProvider = async () => [mockAgent];
                setAgentProvider(mockAgentProvider);

                injectTask({
                    id: 'single-task',
                    agent: 'weather',
                    prompt: 'Single task',
                    dependsOn: [],
                });

                expect(getCurrentDAG().tasks).toHaveLength(1);

                const instructionsPromise = getNextInstructionsWorkflow.createRun()
                    .then(run => run.start({ inputData: {} }));

                await new Promise(resolve => setTimeout(resolve, 50));
                simulateTaskCompletion('single-task', 'Done');

                await instructionsPromise;

                expect(getCurrentDAG().tasks).toHaveLength(0);
            });

            it('should not reset DAG when tasks are still pending', async () => {
                const mockAgent = createMockAgent('weather', 'Provides weather information');
                const mockAgentProvider: AgentProvider = async () => [mockAgent];
                setAgentProvider(mockAgentProvider);

                injectTask({
                    id: 'task-1',
                    agent: 'weather',
                    prompt: 'Task 1',
                    dependsOn: [],
                });
                injectTask({
                    id: 'task-2',
                    agent: 'weather',
                    prompt: 'Task 2',
                    dependsOn: [],
                });

                const instructionsPromise = getNextInstructionsWorkflow.createRun()
                    .then(run => run.start({ inputData: {} }));

                await new Promise(resolve => setTimeout(resolve, 50));
                simulateTaskCompletion('task-1', 'Done 1');

                await instructionsPromise;

                expect(getCurrentDAG().tasks).toHaveLength(2);
            });
        });
    });

    describe('routePromptWorkflow with mock agents', () => {
        it('should list available mock agents', async () => {
            const weatherAgent = createMockAgent('weather', 'Provides weather information for any location');
            const calendarAgent = createMockAgent('calendar', 'Manages calendar events and schedules');

            const mockAgentProvider: AgentProvider = async () => [weatherAgent, calendarAgent];
            setAgentProvider(mockAgentProvider);

            const result = await routePromptWorkflow.createRun()
                .then(run => run.start({
                    inputData: {
                        userQuery: 'What is the weather in Aarhus?'
                    }
                }));

            const dag = getCurrentDAG();
            expect(dag.tasks.length).toBeGreaterThanOrEqual(1);

            const weatherTask = dag.tasks.find(t => t.agent === 'weather');
            expect(weatherTask).toBeDefined();
        });

        it('should start DAG execution and return tasks in progress', async () => {
            const weatherAgent = createMockAgent('weather', 'Provides weather information for any location');
            const mockAgentProvider: AgentProvider = async () => [weatherAgent];
            setAgentProvider(mockAgentProvider);

            const workflowResult = await routePromptWorkflow.createRun()
                .then(run => run.start({
                    inputData: {
                        userQuery: 'What is the weather?'
                    }
                }));

            const result = assertWorkflowSuccess(workflowResult);
            expect(result.taskIdsInProgress).toBeDefined();
            expect(Array.isArray(result.taskIdsInProgress)).toBe(true);
        });
    });

    describe('integration: calling getNextInstructionsWorkflow before routePromptWorkflow', () => {
        it('should properly receive completed tasks even when waiting started before DAG creation', async () => {
            const weatherAgent = createMockAgent('weather', 'Provides weather information for any location');
            const mockAgentProvider: AgentProvider = async () => [weatherAgent];
            setAgentProvider(mockAgentProvider);

            const instructionsPromise = getNextInstructionsWorkflow.createRun()
                .then(run => run.start({ inputData: {} }));

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(getTaskCompletedListenersCount()).toBe(1);

            injectTask({
                id: 'weather-task',
                agent: 'weather',
                prompt: 'Get weather',
                dependsOn: [],
            });

            simulateTaskCompletion('weather-task', 'Weather result: Sunny');

            const workflowResult = await instructionsPromise;

            const result = assertWorkflowSuccess(workflowResult);
            expect(result.completedTaskResults).toHaveLength(1);
            expect(result.completedTaskResults?.[0].id).toBe('weather-task');
            expect(result.completedTaskResults?.[0].result).toBe('Weather result: Sunny');
            expect(result.instructions).toContain('All tasks have completed');
        });

        it('should handle multiple getNextInstructionsWorkflow calls waiting in parallel', async () => {
            const weatherAgent = createMockAgent('weather', 'Provides weather information');
            const mockAgentProvider: AgentProvider = async () => [weatherAgent];
            setAgentProvider(mockAgentProvider);

            const promise1 = getNextInstructionsWorkflow.createRun()
                .then(run => run.start({ inputData: {} }));
            const promise2 = getNextInstructionsWorkflow.createRun()
                .then(run => run.start({ inputData: {} }));

            await new Promise(resolve => setTimeout(resolve, 100));
            expect(getTaskCompletedListenersCount()).toBe(2);

            injectTask({
                id: 'task-a',
                agent: 'weather',
                prompt: 'Task A',
                dependsOn: [],
            });
            injectTask({
                id: 'task-b',
                agent: 'weather',
                prompt: 'Task B',
                dependsOn: [],
            });

            simulateTaskCompletion('task-a', 'Result A');

            const workflowResult1 = await promise1;
            const result1 = assertWorkflowSuccess(workflowResult1);
            expect(result1.completedTaskResults?.some((t: { id: string }) => t.id === 'task-a')).toBe(true);

            simulateTaskCompletion('task-b', 'Result B');
            const workflowResult2 = await promise2;
            const result2 = assertWorkflowSuccess(workflowResult2);
            expect(result2.completedTaskResults?.some((t: { id: string }) => t.id === 'task-b')).toBe(true);
        });
    });
});
