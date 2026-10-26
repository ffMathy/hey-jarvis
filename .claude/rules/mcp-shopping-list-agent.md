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
- **Danish product aliases**: Supports synonyms like "Soja → Sojasauce", "Rødkål → Rød spidskål"
- **Automatic authentication**: JWT token management with renewal for Bilka APIs
- **Error recovery**: Retry logic with simplified search terms and graceful failure handling

**Converted from n8n**: This agent maintains all the complex logic from the original n8n Shopping List Agent workflow, including the comprehensive priority hierarchy, special rules for herbs and quantities, and Danish product handling.
