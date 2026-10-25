---
paths:
  - "mcp/**"
---

# Questions for the user

> Part of [Routing](mcp-routing.md). Paths in it are relative to `mcp/` unless they say otherwise.

Some work cannot finish on what the request said. Questions come from two places, and
`verticals/routing/questions.ts` keeps both kinds as an `OpenQuestion` until sir answers:

- **A tool that suspends.** Any routable agent whose tool suspends with a `question`, and resumes
  with a single text field, suspends the agent inside that tool call. Its answer resumes that agent
  (the steps below).
- **Work outside any request.** A Claude Code session implementing a change asks long after the
  request that started it was answered (see **Questions a coding session asks** under the coding
  vertical). Nothing is suspended then, so the question is opened with `openAnsweredByQuestion` and
  a `deliverAnswer` function, asked over a channel his answer can come back on (`askQuestion`), and
  its answer is handed to that function. What the function returns is the delegation's result.

A suspending tool goes like this:

1. The suspension reaches the plan run as a `workflow-step-output` wrapping the agent's
   `tool-call-suspended` chunk, carrying the agent run id, the tool call id, the question and the
   resume schema. That is the only place it shows.
2. **The plan run is then stopped.** Mastra's agent step resolves on the agent's `onFinish`, and a
   suspended agent never finishes, so the step — and the run, and the stream routing reads — would
   wait forever while Jarvis heard "Still processing" on every poll. Once every delegation in the
   plan has answered or asked, `consumeRun` cancels the run. The suspended agent is not part of it:
   it is persisted in storage as an `agentic-loop` run of its own, which is what gets resumed.
3. The closing report carries the question in `questionsForUser`, with instructions to ask it last
   and stop. Questions wait for the closing report because sir's answer arrives as a new request,
   and a new request supersedes the old one — asking early would cancel whatever else was still
   running the moment he replied.
4. His answer comes back through **`routePromptWorkflow`**, like everything else he says. Open
   questions are kept past the request that asked them and shown to the planner alongside every
   request; the planner's `answers` field says which question a request answers, if any. That keeps
   the answer on the existing two tools and keeps Jarvis from having to label a reply as one.
5. The answer resumes the agent with `agent.resumeStream({ [field]: answer }, { runId, toolCallId })`.
   The tool gets the answer, the workflow carries on, and the agent either finishes — its text is
   the delegation's result — or stops on the next question, which is asked in turn.

A question sir ignores stays open: talking about something else plans that as usual, and the
answer is still taken later. It is not forgotten either: the closing report of the next request he
makes carries every question still waiting in `questionsForUser`, and Jarvis answers the request,
then reminds him of the question and asks it last (`takeQuestionsToBringUp` in `questions.ts`).
That is what rescues a question asked on a call he missed or in a push notification. A question
brought up is left alone for 30 minutes (`QUESTION_REMINDER_INTERVAL_MS`), so a conversation hears
it once rather than after every request, and a superseded request, one he is to be notified about or
one he stopped brings nothing up, since nobody hears it in that report. Two requests sharing a report
— one joined to the other as `adds` — each bring up what is due as their own work ends, one that only
waves a photo away included, and the report keeps what either took for as long as it still stands:
the second to finish does not wipe out the reminder the first one took, and drops one about a question
it has answered or a photo it has waved away. `waiting-photos.spec.ts` holds the second request's plan
back until the first has finished, which is the order that loses them. Open questions live in memory,
so a restart forgets them while the suspended run stays in storage; the request then has to be made
again.

**A photo he sent that nobody has looked at yet** is brought up the same way (`takePhotosToBringUp`
in `routing/waiting-photos.ts`, into `waitingPhotos` beside `earlierQuestions`): after the earlier
questions and before the request's own in `questionsForUser`, under the same conditions, and in the
failure path too. The instructions name a photo — "work he started earlier, or a photo he sent" — and
ask for its id in the reply as `(photo photo3)` only when one is waiting, so every other report reads
as it did. The difference is the reply: it is not an answer to hand back but a request, which the
planner, shown every waiting photo, plans as work on that photo — or, for "nothing", as dismissing it
(`dismissedPhotoIds`), which the instructions ask to be routed like any other reply. See **A photo
nobody has looked at is not lost with the conversation** under [Vision Vertical](mcp-vision-vertical.md#vision-vertical).

**A photo he sent with nothing said** is asked about too, as this request's own question rather than
one from earlier. The request is the look — `He sent a photo without saying what he wants: look at it
and say what it shows (photo photo3)` — and the planner names the photo in `photosToAskAbout`
(required, empty-when-absent, and only ever a photo it was shown and did not dismiss). Once the
request's work is done, the controller keeps those whose look actually read them
(`RoutingProgress.photosToAskAbout`), and the closing report adds one question per photo, last in
`questionsForUser`, with the photo id as its id: `Now that you have told him what photo3 shows, ask
him what he would like done with it.` (`askWhatToDoWithPhoto`). It is closed with
`askTheUserInstructions` as a request waiting on him, photo wording included, so Jarvis speaks the
result, asks, and waits — never `end_call`. A photo asked about that way is not also brought up as a
waiting one, and a request that failed asks nothing about its photos: one whose look failed is still
waiting, and is brought up later like any other. His "nothing" in reply is a dismissal: the photo is
listed to the planner because his reply names it (see **"Nothing, never mind" dismisses it** under
[Vision Vertical](mcp-vision-vertical.md#vision-vertical)). A request he talks over before it is heard takes its look back,
so the photo is brought up later instead. `waiting-photos.spec.ts` drives all of this end to end on
scripted models, from the routed message to the report that asks — and, with a stand-in classifier
(`setRoutingClassifierForTest`), requests that join a running one.

A reply given on a call or on the house speakers only reaches the work if the ElevenLabs agent
routes it, so its prompt (`elevenlabs/src/assets/agent-prompt.md`) says a reply to a question the
call opened with is passed to `routePromptWorkflow` with the question it answers, never merely
acknowledged. Before that rule, an answer given on a call could go no further than the call.

`coding-interview.spec.ts` runs the whole coding path — the two MCP tools, the planner, the coding
agent, the session watcher asking a session's question, and the answer reaching that session — on
scripted models.
