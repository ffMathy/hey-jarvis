import { PinoLogger } from '@mastra/loggers';

/**
 * Centralized logger for the entire application
 *
 * Uses Pino logger with console transport enabled by default.
 * This logger should be used instead of console.log throughout the codebase
 * to maintain consistent logging and ensure logs are properly tracked.
 *
 * This single logger instance is shared across all components including
 * Mastra core framework, verticals, tools, workflows, and utilities.
 */
export const logger = new PinoLogger({
  name: 'Mastra',
  level: 'info',
});
