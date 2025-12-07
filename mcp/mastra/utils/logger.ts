import { PinoLogger } from '@mastra/loggers';

/**
 * Centralized logger for Mastra verticals
 *
 * Uses Pino logger with console transport enabled by default.
 * This logger should be used instead of console.log throughout the codebase
 * to maintain consistent logging and ensure logs are properly tracked.
 */
export const logger = new PinoLogger({
  name: 'Mastra-Verticals',
  level: 'info',
});
