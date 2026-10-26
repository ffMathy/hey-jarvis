---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.kt"
  - "**/*.java"
  - "**/*.cpp"
  - "**/*.h"
---

# SOLID

Five principles for code that is easy to change. They apply to modules and functions as much as to classes. Apply them to remove a pain you have, not pre-emptively — an interface for every class is [Speculative Generality](code-smells.md#speculative-generality).

---

## Single Responsibility Principle

**Rule:** a module, class or function has **one reason to change** — it serves one actor or one concern.

**Why:** when unrelated concerns share code, a change for one breaks the other, and every review touches both.

**Signs of violation:** [Divergent Change](code-smells.md#divergent-change), [Large Class](code-smells.md#large-class); a name with "and" in it; a file that imports both an HTTP client and a rendering library; tests that need to mock half the world.

❌ **BAD**
```typescript
class WeatherReport {
  async fetch(city: string) { return (await fetch(`${apiUrl}?q=${city}`)).json(); }
  format(report: Report) { return `${report.city}: ${report.temperature}°C`; }
  async saveToDatabase(report: Report) { await database.insert('reports', report); }
}
```
✅ **GOOD**
```typescript
const fetchWeather = (client: WeatherClient, city: string) => client.current(city);
const formatWeather = (report: Report) => `${report.city}: ${report.temperature}°C`;
const saveWeather = (repository: ReportRepository, report: Report) => repository.save(report);
```

**Cure:** [Extract Class](refactoring-moving-features.md#extract-class), [Extract Method](refactoring-composing-methods.md#extract-method). In this repository, vertical organisation (see [`mastra`](mastra.md)) applies the same principle at folder level.

## Open/Closed Principle

**Rule:** code should be **open for extension, closed for modification** — adding a new variant should mean adding code, not editing working code.

**Why:** every edit to working code risks breaking existing behaviour; additions are isolated.

**Signs of violation:** [Switch Statements](code-smells.md#switch-statements) on a kind repeated in several places; [Shotgun Surgery](code-smells.md#shotgun-surgery) whenever a new provider or format is added.

❌ **BAD**
```typescript
function notify(channel: string, message: string) {
  if (channel === 'email') return sendEmail(message);
  if (channel === 'push') return sendPush(message);
  // every new channel edits this function
}
```
✅ **GOOD**
```typescript
const notifiers = {
  email: sendEmail,
  push: sendPush,
} satisfies Record<string, (message: string) => Promise<void>>;

const notify = (channel: keyof typeof notifiers, message: string) => notifiers[channel](message);
```

**Cure:** [Replace Conditional with Polymorphism](refactoring-simplifying-conditionals.md#replace-conditional-with-polymorphism), [Strategy](design-patterns-behavioral.md#strategy). Do not over-apply: a single exhaustive `switch` that the compiler checks is fine.

## Liskov Substitution Principle

**Rule:** a subtype must be usable **anywhere** its parent type is expected, without callers noticing — same inputs accepted, same guarantees given, no new exceptions.

**Why:** if callers must check which subtype they hold, polymorphism is broken and every caller grows special cases.

**Signs of violation:** [Refused Bequest](code-smells.md#refused-bequest); overrides that throw `not supported`; `instanceof` checks before calling a method; a subclass that tightens what inputs it accepts or weakens what it returns.

❌ **BAD**
```typescript
class Bird { fly() { … } }
class Penguin extends Bird {
  fly() { throw new Error('penguins cannot fly'); }
}
```
✅ **GOOD**
```typescript
interface Bird { move(): void }
class Sparrow implements Bird { move() { this.fly(); } private fly() { … } }
class Penguin implements Bird { move() { this.swim(); } private swim() { … } }
```

**Cure:** [Replace Inheritance with Delegation](refactoring-generalization.md#replace-inheritance-with-delegation), [Extract Interface](refactoring-generalization.md#extract-interface), [Push Down Method](refactoring-generalization.md#push-down-method).

## Interface Segregation Principle

**Rule:** no client should depend on members it does not use. Prefer several small, role-specific interfaces over one large one.

**Why:** a fat interface couples clients to changes they do not care about, and makes test doubles tedious to write.

**Signs of violation:** implementations full of `throw new Error('not implemented')` or no-op methods; test fakes that stub twenty methods to exercise one; a function that takes a whole service to read one field.

❌ **BAD**
```typescript
interface SmartHome {
  turnOnLight(id: string): Promise<void>;
  setThermostat(temperature: number): Promise<void>;
  lockDoor(id: string): Promise<void>;
}
function welcomeHome(home: SmartHome) { return home.turnOnLight('hallway'); }
```
✅ **GOOD**
```typescript
interface LightControl { turnOnLight(id: string): Promise<void> }
function welcomeHome(lights: LightControl) { return lights.turnOnLight('hallway'); }
```

**TypeScript:** structural typing makes this cheap — a narrow parameter type (or `Pick<SmartHome, 'turnOnLight'>`) is accepted by any object that has the member, with no `implements` needed.

**Cure:** [Extract Interface](refactoring-generalization.md#extract-interface), [Preserve Whole Object](refactoring-simplifying-method-calls.md#preserve-whole-object) with a narrow type.

## Dependency Inversion Principle

**Rule:** high-level policy should not depend on low-level details; **both depend on abstractions**, and the abstraction is owned by the high-level side.

**Why:** domain logic that imports an SDK directly cannot be tested without it, and cannot switch providers without a rewrite.

**Signs of violation:** domain functions that `new` their own HTTP clients, database connections or SDK clients; tests that need network access or module mocking to run (see [`validation`](validation.md) — `*.spec.ts` must run offline).

❌ **BAD**
```typescript
import { GoogleCalendarClient } from 'google-calendar-sdk';

export async function nextMeeting() {
  const client = new GoogleCalendarClient(process.env.CALENDAR_TOKEN);
  return (await client.events.list({ maxResults: 1 })).items[0];
}
```
✅ **GOOD**
```typescript
export interface CalendarSource { upcomingEvents(limit: number): Promise<CalendarEvent[]> }

export async function nextMeeting(calendar: CalendarSource) {
  const [meeting] = await calendar.upcomingEvents(1);
  return meeting;
}
// wiring: nextMeeting(createGoogleCalendarAdapter(client)); tests: nextMeeting(fakeCalendar)
```

**Cure:** pass dependencies in (parameters, factory arguments); wrap SDKs in an [Adapter](design-patterns-structural.md#adapter) that implements the domain's interface; create concrete instances only at the composition root (the factories and `index.ts` wiring).
