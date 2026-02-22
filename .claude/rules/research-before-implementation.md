# Research and Planning Before Implementation

**CRITICAL: ALWAYS plan in a separate agent and research before starting any task.**

## Planning Phase (MANDATORY)

Before implementing ANY task, you MUST spawn a **Explore agent** (`subagent_type: "Explore"`) to:

1. Explore the codebase and understand the affected areas
2. Perform **at minimum 1 web search** for current best practices (more is better)
3. Design the implementation approach
4. **Identify which steps can be parallelized** — the plan must explicitly mark each step as either:
   - **Parallel**: can run independently as a background task (e.g., changes to unrelated files/projects)
   - **Sequential**: depends on a prior step's output and must wait

The Explore agent cannot edit files — it only researches and recommends. This keeps the main conversation context lean.

### What the Plan Must Include

- List of steps with clear descriptions
- Files to be modified in each step
- Parallelization markers (`parallel` / `sequential` + dependency) for each step
- Web research findings that informed the approach

## Research Requirements

The Explore agent must search for:
- Current best practices and patterns
- Latest library versions and APIs
- Security considerations and common pitfalls
- Existing solutions and examples
- Documentation and tutorials

### When to Search

✅ **ALWAYS search before:**
- Implementing any new feature
- Choosing a library or dependency
- Making architectural decisions
- Writing complex algorithms
- Working with unfamiliar APIs or frameworks
- Encountering errors or issues
- Being uncertain about best practices

## Example Flow

```
// STEP 1: Spawn Explore agent (REQUIRED)
// The Explore agent explores the codebase, performs web searches,
// and returns a structured plan with parallelization markers.

// STEP 2: Review the plan
// Check the proposed steps and their parallel/sequential markers.

// STEP 3: Execute
// Launch parallel steps as background tasks simultaneously.
// Run sequential steps in order after their dependencies complete.
```

## Search Tool
Use your preferred search engine (Google, Bing, DuckDuckGo, etc.) and consider using advanced search operators to narrow down results. Always check the date of the information to ensure it's current.

**Remember**: Plan first, research always, parallelize when possible. Never skip any of these steps!
