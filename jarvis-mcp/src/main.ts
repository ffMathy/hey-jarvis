/**
 * Hello World Jarvis MCP Application
 */

console.log('Hello World from Jarvis MCP!');

class HelloWorldMCP {
  private name: string;

  constructor(name: string = 'MCP') {
    this.name = name;
  }

  greet(): string {
    const message = `Hello, ${this.name}!`;
    console.log(message);
    return message;
  }

  start(): void {
    console.log('Starting Hello World Jarvis MCP Application...');
    this.greet();
    console.log('Jarvis MCP Application running successfully!');
  }
}

// Start the application
const mcpApp = new HelloWorldMCP('Jarvis MCP');
mcpApp.start();
