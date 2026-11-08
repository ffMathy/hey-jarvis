---
paths:
  - "mcp/**"
---

# Shopping List Agent

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

Provides intelligent shopping list management for Bilka online store with Danish language support:
- **4 Bilka integration tools**: Product search via Algolia, cart quantity management, cart retrieval, and cart clearing
- **Whole lists in one call**: `findProductInCatalog` takes `search_queries` and `setProductBasketQuantity` takes `items`, so a shopping list is one tool call each rather than one model round trip per product. Each search sends all six preference filters in a single Algolia request, and callers arriving together share one Bilka sign-in
- **Reports the basket it touches**: reading, emptying or changing the basket reports `BILKA_BASKET` (`bilka-basket`, "Shopping basket") for sir's headset to light up; a catalogue search reports nothing (see [What a request touches](mcp-routing-affected-entities.md#affected-entities))
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing in Danish
- **Priority-based selection**: Organic certification, Danish origin, healthier options, and price optimization
- **Smart quantity handling**: Balances food waste reduction with requested quantities (20% tolerance)
- **Special product logic**: Separate handling for herbs (fresh vs dried), garlic units, and bundled vegetables
- **The household's aliases and preferences**: "Soja → Sojasauce", "Rødkål → Rød spidskål", skummetmælk, juice not from concentrate, sliced solid cheese — kept in Knowledge, see below
- **Automatic authentication**: JWT token management with renewal for Bilka APIs
- **Error recovery**: Retry logic with simplified search terms and graceful failure handling

**Converted from n8n**: This agent maintains all the complex logic from the original n8n Shopping List Agent workflow, including the comprehensive priority hierarchy, special rules for herbs and quantities, and Danish product handling.

## The household's aliases and preferences

Which product the household means by a name on the list, and which of several it prefers, are the household's
own, so they are a page in Jarvis's Knowledge, `conventions:home#shopping` (see [Knowledge](mcp-knowledge.md)),
rather than lines in the agent's instructions:

- **The body is in code**: `shoppingConventions` in `verticals/shopping/conventions.ts`, written to the page the first
  time a process reads it, so Studio's Knowledge page shows what the code says. Change a convention Jarvis is built
  with there.
- **What sir has said since is a note on the page.** The agent holds the household (`householdKnowledgeOptions`), and
  its instructions tell it to add a lasting preference sir states — "buy letmælk from now on" — as one note with
  `knowledge_note`. It can add notes and cannot rewrite the body.
- **Both reach the agent on every run.** `shoppingListAgentInstructions(knowledge)` reads the page with
  `readConventions` and puts it, notes dated and oldest first, in the "Aliases, Variants & Synonyms" section, where the
  aliases always were. `getShoppingListAgent(getKnowledge = getJarvisKnowledge)` opens the process's Knowledge and
  gives it to the agent; `agents.spec.ts` hands it one on an `InMemoryStore`, and checks that the agent holds
  `household:home` on it and reads a note added there on its next run.

**What stays in the instructions**, because it is true of shopping at Bilka rather than of this household, or because
code enforces it too: that products are named in Danish, the organic markers (ØKO, Økologisk, Organic, Bio), the
priority hierarchy — which `ATTRIBUTE_PREFERENCE_ORDER` in `tools.ts` applies to every search — and the rules for
herbs, quantities, vegetables, searching and the tool calls. The instructions name their sections ("see the Priority
Hierarchy") rather than numbering them, so a section the conventions bring in cannot shift what a reference points at.

**Only this agent reads them.** The shopping workflow's mutator agent and the product-choice classifier never had the
aliases, and are not given the page: it would change which product they pick.
