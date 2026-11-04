---
paths:
  - "mcp/**"
---

# The Baby's Share of the Dinner

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

The household has a baby who eats from the family's dinners. The cooking vertical plans and suggests
those dinners with the baby in mind, at the baby's age on the day, following the Danish Health
Authority's book **"Mad til små – fra mælk til familiens mad"** (Sundhedsstyrelsen, Fødevarestyrelsen
and Komiteen for Sundhedsoplysning, 5th edition, 2020). It is all in `verticals/cooking/baby-food.ts`.

**The birth date is never in the code.** The repository is public, and a Danish birth date is the
first six digits of a CPR number. It is read from `HEY_JARVIS_BABY_BIRTH_DATE` (`YYYY-MM-DD`), resolved
from `op://Jarvis/Baby/Birth date` through `mcp/op.optional.env`. Specs use a made-up date.

| `HEY_JARVIS_BABY_BIRTH_DATE` | What happens |
| --- | --- |
| a past date | every meal plan and recipe suggestion follows the advice for the baby's age that day |
| unset | dinners are planned for the adults only, as if there were no baby; the server logs one warning |
| anything else | every cooking request and meal plan fails, naming the variable but never its value, and the server warns at startup: a plan meant to feed a baby must not quietly become one for adults |

**The advice is data, one piece per line of the book.** `BABY_FOOD_ADVICE` holds every piece with
the pages it rests on and the ages it holds for (`fromMonths`, and `untilMonths` when it stops). The
guidance for a day is every piece whose window holds the baby's age that day, in whole months on the
household's clock (`babyAgeInMonths`), so it moves with the baby without anyone touching it. It
follows the book's own thresholds: first tastes from 4 months; meat, fish and egg from 6; small soft
pieces from 8; fried fish and the family's meals at 9; honey and drinking milk at 1 year; skyr and
the other high-protein dairy at 2; tinned tuna at 3; tuna steaks and the other large predatory fish
at 14. Before 4 months the baby only drinks milk, and nothing is said about it at all. To change a
piece, change its line and its page; `baby-food.spec.ts` pins the thresholds above.

**Where it reaches.** `currentBabyMealGuidance()` is read afresh on every run, because the server
stays up for days and the baby keeps growing; the agents' instructions are functions for that reason
(`buildGenerateMealPlanWorkflow`, `getCookingAgent`).

- **The recipe selector** picks dinners the baby can share, by the book's own priorities for the
  week: meat or fish in every dinner for its iron, potatoes as the staple, one of the week's two
  dinners a fish dinner (fish as the main course twice a week), not two dinners with rice (arsenic),
  no diet dishes, and nothing built around what it must not have yet.
- **The scheduler** keeps the dinner the adults' food, moves chili and most of the salt to after the
  baby's portion is set aside (chili may go on the table, salt never: "Lad være med at sætte salt på
  bordet", p. 96), and adds one direction starting with "Til baby:" — when to take its portion out,
  how to prepare it at its age, and how to keep and reheat it for the following days. Each dinner
  lasts three days, which the advice has to survive: the book's cooling and reheating rules apply,
  raw herbs go on the adults' plates only so the leftovers can be kept, a rice dinner gives the baby
  potatoes or pasta on some of its days, and one heavy in spinach, beetroot, fennel or celery is the
  baby's on one day only. It cooks a little for the baby's share as well, since a baby starting near
  6 months soon eats proper meals (p. 14); from 1 year, a little extra for its lunch the next day.
  The email keeps the "Til baby:" label bold.
- **The cooking agent** prefers dinners the baby can share when it suggests one, and says briefly
  how to prepare the baby's portion.

**What the book says that the earlier guidance got wrong.** It was written from a dairy industry
leaflet. The book has no ban on spices — its own family dinners use garlic, curry, cumin, ginger and
pepper, with chili only as an optional hint — and it wants the baby to learn many tastes, sour and
bitter too. Its list of large predatory fish is longer (perch, zander, oilfish, escolar, ray) and
names halibut as "helleflynder", not "hellefisk"; its nitrate-rich vegetables are spinach, beetroot,
fennel and celery, not rocket (about a tenth of the portion until 1 year); honey is ruled out only
until 1 year; and it adds what the leaflet left out: no yoghurt before 9 months, no skyr before
2 years, cow's milk only cooked into family dishes before 9 months, rice not every day, fish twice a
week, peanuts, whole nuts and popcorn not before about 3 years, and how a dinner eaten over three
days is kept and reheated. The Danish names the recipes use are in the advice beside the English.

**How the advice was checked.** Every page of the book was read by one agent per section, each
rule was checked against its page by a second agent told to refute it, and a third drew them
together by age and compared them with the earlier guidance. The advice here was then checked
against that synthesis and against the pages themselves. Anything the book does not say is left
out, however sensible it sounds.

**Testing.** `baby-food.spec.ts` covers reading the date, the age on the household's clock, and the
book's thresholds. `workflows.spec.ts` runs the real meal plan on a Mastra instance, with Valdemarsro
faked at `fetch` and a scripted model, and checks that both agents are told the baby's age on the day
each plan is made: the same workflow, built once, tells them 6 months and then, three months on,
9 months.
