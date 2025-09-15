# E2E Agents

## Overview
This document describes the agents and automation capabilities for the E2E (End-to-End) project in the Hey Jarvis monorepo.

## Project Description
A simple Hello World TypeScript application that demonstrates basic application structure and serves as a foundation for future end-to-end testing capabilities.

## Key Features
- Simple TypeScript-based "Hello World" application
- Demonstrates basic class structure and method execution
- Foundation for future testing automation and integration

## Agents & Automation
Currently implements:
- **HelloWorldApp**: A basic application agent that demonstrates greeting functionality
- Simple logging and execution flow

## Future Capabilities
- Integration with other Hey Jarvis components
- Automated testing workflows
- Cross-project communication validation

## Usage
```bash
# Build the application
npx nx build e2e

# Run the application
npx nx serve e2e
```

## Development
The application is built using TypeScript and follows NX monorepo conventions. All source code is located in the `src/` directory.