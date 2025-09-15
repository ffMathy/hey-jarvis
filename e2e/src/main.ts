/**
 * Hello World E2E Application
 */

console.log('Hello World from E2E!');

class HelloWorldApp {
  private name: string;

  constructor(name: string = 'World') {
    this.name = name;
  }

  greet(): string {
    const message = `Hello, ${this.name}!`;
    console.log(message);
    return message;
  }

  run(): void {
    console.log('Starting Hello World E2E Application...');
    this.greet();
    console.log('E2E Application completed successfully!');
  }
}

// Create and run the application
const app = new HelloWorldApp('E2E');
app.run();
