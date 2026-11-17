---
paths:
  - "mcp/**"
---

# The Household's Dinner Conventions

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

How the household likes its dinners is the household's own, so it is a page in Jarvis's Knowledge,
`conventions:home#cooking` (see [Knowledge](mcp-knowledge.md)), rather than a line repeated in each agent's
instructions. Today it holds the one convention both agents that choose a dinner were each given in their own words
before: avoid weird soups, such as "burgersuppe", "tacosuppe" and "lasagnesuppe".

- **The body is in code**: `cookingConventions` in `verticals/cooking/conventions.ts`, written to the page the first
  time a process reads it, so Studio's Knowledge page shows what the code says. Change a convention Jarvis is built
  with there.
- **What sir has said since is a note on the page.** The cooking agent holds the household
  (`householdKnowledgeOptions`), and its instructions tell it to add a lasting dinner convention sir states — "no
  mushrooms from now on" — as one note with `knowledge_note` (`conventionsNoteInstructions`). It can add notes and
  cannot rewrite the body.
- **Both reach the agents that choose a dinner, on every run**, as a section headed "The household's dinner
  conventions" (`dinnerConventionsSection`) that one of their rules points to. The instruction builders stay pure and
  take the text; the async instruction functions read it with `readConventions` from a Knowledge they are handed:
  - **the cooking agent**: `getCookingAgent(getKnowledge = getJarvisKnowledge)` opens the Knowledge, gives it to the
    agent, and reads the page for `cookingAgentInstructions(babyGuidance, conventions)`;
  - **the meal plan's recipe selector**: `buildGenerateMealPlanWorkflow(model, getKnowledge)` reads it for
    `mealPlanRecipeSelectorInstructions(babyGuidance, conventions)`. The selector is an agent step with no tools and
    no memory, so it only reads them. `generateMealPlanWorkflow` is built with `getJarvisKnowledge`, which opens
    the store on the first plan rather than when the module is loaded.
- **The scheduler is not given them.** It portions out the two dinners already chosen, and no convention so far is
  about anything it decides. Give it the page when one is.

**What stays in the instructions**, because it is how to use the tools, the shape of the plan, or something code
enforces too:

- the cooking agent's Danish search terms, the "Aftensmad" filter, quantities and detailed recipes, and handing meal
  plans to the workflow;
- the selector's picking only from the candidates by id and preferring dinner dishes (the shortlist keeps to dinner
  recipes, `resolveSelectedRecipeIds` to the shortlist), two recipes that differ in main ingredient and style, which
  only a week's pick is about, and the user's preferences for this plan;
- the scheduler's scaling (6 people, 2 × 3 days, plus the baby's share), the expiry order and Danish weekday names;
- the baby's advice, in `baby-food.ts`: reviewed data pinned by its spec (see
  [The Baby's Share of the Dinner](mcp-cooking-baby-food.md)).

**Testing.** No spec opens the process-wide store: each hands in `createJarvisKnowledge(new InMemoryStore())`.
`workflows.spec.ts` runs the real meal plan and checks that the selector is told the body, and, once a note is added
to the page, the note with its date on the next run of the same workflow. `agents.spec.ts` builds the cooking agent
and checks the same of its instructions, that they say how to add a note, and that the agent holds `household:home`
on that Knowledge.
