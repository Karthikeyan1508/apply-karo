# Apply करो (बोल भरो)

Speak, and it fills the form. Apply करो reads an application form, interviews the user out loud, keeps probing until answers are specific, drafts each answer only from what the user said, and hands the result over for the user to submit. Nothing is submitted without their approval.

Stack: Next.js 16, shadcn/ui (Base UI), Tailwind 4, anime.js, a WebGL shader background and orb, ElevenLabs Agents for voice, Groq for reading forms and writing drafts.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3100. The **demo form works with no keys**: choose Demo, then Watch the demo.

The dev server uses port 3100, not 3000, on purpose. A service worker left behind by another app on `localhost:3000` can hijack the page and break it.

For your own forms and a live agent, copy `.env.example` to `.env.local` and follow [docs/SETUP.md](docs/SETUP.md) (or open `/setup` in the app).

**Keep keys in `.env.local` only.** `.env.example` is committed, so it must stay blank.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3100 |
| `npm run build` | Production build |
| `npm test` | Unit tests (guard, parser, store, tools, drafting, profile, Groq client, spectrum, eval scoring, Hindi demo, errors) |
| `npm run configure:agent` | Applies the prompt, first message, variables, model and the three tools to your ElevenLabs agent, then verifies them (`-- --dry` previews) |
| `npm run smoke:agent` | Talks to the agent in text mode and checks it saves answers with real quotes (`-- --hi` for Hindi and Hinglish) |
| `npm run eval` | The scoreboard: naive form-reader against the real agent, graded by a Groq judge. Writes `data/eval.json` (`-- --runs 1` for a quick check) |
| `npm run check:speech` | Streams synthetic Hindi and Hinglish speech into the live agent and prints what its speech recognition heard |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |

## How it works

1. **Ingest** (`app/api/ingest`): a Google Form is fetched and parsed from its `FB_PUBLIC_LOAD_DATA_` data (no browser needed), or the user pastes the questions. Groq then builds an *intent graph*: for each question, what the form owner really wants and the few facts a strong answer needs ("slots"). If saved facts exist on this device, matching slots are pre-filled and marked "to confirm".
2. **Interview** (`hooks/use-agent.tsx`): an ElevenLabs agent talks to the user. The plan travels as dynamic variables. The agent calls client tools in the browser:
   - `record_answers` saves `{field, slot, value, quote}` (fire and forget, so it adds no latency).
   - `finish_interview` is the correctness gate. It returns anything still open or unconfirmed, so the agent keeps asking.
   - `edit_answer` rewrites one drafted answer during review, from the user's own words.
3. **Guard** (`lib/core.ts`): a value is accepted only if its quote appears in what the user actually said. Invented quotes are rejected and shown in the Evidence panel. A spoken "yes" to a saved fact confirms it and keeps the original quote.
4. **Drafts** (`hooks/use-drafts.ts`, `app/api/draft`): a draft is written per field in the background as facts arrive, from those facts only. Numbers the user never said are flagged. A field the user edited by hand is never redrafted. Without a Groq key, drafts fall back to the user's own wording, joined up.
5. **Review and hand-over** (`components/workspace/review-panel.tsx`, `handoff-panel.tsx`): edit any answer, ask for a rewrite, see the quotes behind it, then Approve. A Google Form opens with every answer pre-filled and the user presses Submit. Other forms get copy-and-paste or JSON.
6. **Saved profile** (`lib/profile.ts`): with a switch the user controls, confirmed facts are saved in this browser and can be forgotten from the landing page or the review screen. They stay in this browser unless the user signs in with Google and turns on sync (see Google sign-in below).
7. **Resume where you left off** (`lib/persist.ts`, `hooks/use-saved-session.ts`): the interview is saved in this browser after every change, so a refresh or a crash loses nothing. The landing page offers Resume or Discard. The clock is shifted by the time away, so the time shown later is time spent interviewing. Nothing is sent anywhere. A `?replay` run is never saved.
8. **Time saved** (`components/workspace/time-saved.tsx`): the hand-over screen shows how long the interview took next to an estimate of typing the same answers by hand (40 words a minute, plus 25 seconds of thinking per long answer). The estimate says it is one. A scripted replay has no honest speaking time, so it shows the typing side only.
9. **Answer strength** (`answerStrength` in `lib/core.ts`, `strength-meter.tsx`): for each long answer, whether it has your own part, a number, an outcome and enough detail. It checks only what that form's slots can satisfy, and facts that are still waiting for a yes do not count.
10. **Resume upload** (`app/api/document`, `lib/document.ts`): a PDF (text read with `unpdf`), a text file, or pasted text. Groq finds facts for the open slots, each with a quote from the document. The page checks every quote against the document again, and keeps the ones that are really there. They arrive as "to confirm" facts labelled with the file name, and the agent asks only about the gaps. The document is read once and not stored. A scanned PDF has no text to read: paste it instead.

Resilience built in: a scripted demo replay (no keys, no network), a text-only mode (noisy rooms), a paste-the-questions path for forms that can't be fetched, and a CSS fallback if WebGL is unavailable.

```
app/api/ingest        form -> session (Google parse + Groq intent graph)
app/api/draft         one answer from the user's facts (Groq, or a plain join)
app/api/prefill       match saved facts to new slots (Groq)
app/api/document      file -> text, and text + open slots -> quoted facts (Groq)
app/api/auth/*        Neon Auth's own API (sign-in, callback, session, sign-out), proxied
app/api/history       the signed-in person's filled forms (GET, PUT, DELETE)
app/api/account       who is signed in and what they can do (never a token)
app/api/profile       the signed-in user's synced facts (GET, PUT, DELETE)
app/api/onboard/github  public GitHub profile and top repositories, as one source (GITHUB_TOKEN optional)
app/api/onboard/extract sources -> profile facts, each quote checked against its source (Groq)
app/api/voice/session connect info for the agent (public id, or token for a private agent)
app/api/health        which keys are configured
app/setup             copy-paste agent setup, with live status
app/scoreboard        baseline against Apply करो, read from data/eval.json
data/eval.json        the last `npm run eval` result (committed, so the page has numbers)
lib/core.ts           guard, coverage, drafts, hand-over, profile logic (pure, tested)
lib/interview-store.ts  reducer + tiny store shared by tools, voice and demo
lib/tools.ts          the three client tools the agent calls
lib/llm.ts            the only file that talks to Groq (strict JSON schema)
lib/gforms.ts         Google Form parser and URL allowlist
lib/agent-prompt.ts   the prompt and tool definitions to paste into ElevenLabs
lib/gl.ts             WebGL helper for the two shaders
lib/demo.ts           demo forms (job in English and Hindi, merchant loan in Hindi), scripted interviews, scripted drafts, ?replay flag
lib/persist.ts        save and restore the interview in this browser (pure parts tested)
lib/document.ts       upload a file, pre-fill open slots from it, re-check every quote
lib/auth.ts           same-origin check and the account info the browser may see
lib/auth/             Neon Auth server and client instances
lib/identity.ts       the signed-in user, from Neon Auth
lib/history*.ts       filled forms: record, store (Postgres or memory), client, dashboard hook
lib/profile-store.ts  synced facts: Postgres through Neon's driver, or in memory for tests
lib/eval.ts           simulated applicant, judge schema, scoring, aggregation (pure, tested)
lib/agent-errors.ts   microphone / network / refused / setup errors in plain words (pure, tested)
lib/replay.ts         reads the ?replay flag once per page load
hooks/                agent (voice, text, demo), drafts, health, profile count
scripts/              configure-agent, smoke-agent, eval, speech-check
components/shader/    background and orb shaders
components/workspace/ plan, talk, review, hand-off and evidence panels
components/landing/   landing page
```

## ElevenLabs setup and MCP

The agent is configured from code, not by hand: `lib/agent-prompt.ts` is the single source, and `npm run configure:agent` pushes it to the agent named in `.env.local` (tools are matched by name, so it is safe to re-run). `.mcp.json` registers the official ElevenLabs MCP server (`elevenlabs-mcp`, needs `uv`) through `scripts/elevenlabs-mcp.mjs`, which reads the key from `.env.local`. In Claude Code, approve the project server and its tools (`get_agent`, `list_agents`, `simulate_conversation`, `get_conversation`, text to speech and more) become available.

## Your profile (onboarding and autofill)

Say it once. Add your resume, your GitHub and your LinkedIn profile, and BolBharo builds a profile from them. Every fact comes with the words it came from, and facts that cannot be quoted are dropped. You review and edit the facts, then the interview asks only what the sources did not answer (by voice or text, through the same interview as a form).

- **Sources.** A resume (PDF, TXT or Markdown, or pasted text). GitHub: a username or profile link. The server reads your public profile, your top six non-fork repositories and their READMEs, with `api.github.com` as the only host. LinkedIn is not scraped: save your profile to PDF and upload it, or paste its text. The profile link is kept as a link only.
- **Reading.** One Groq extraction per piece of text (at most five pieces per onboarding). Each returned fact must carry a quote that appears in its source, checked in code (`lib/profile-ground.ts`). Sensitive facts (pay, date of birth, caste, government ids and similar) are marked and never filled in unless you switch on **OK to autofill**.
- **Autofill.** When a form is read, or any session starts, confirmed non-sensitive facts fill matching questions as answers, with their source shown. Anything else waits for a one-line confirmation in the interview. Long free-text answers are still drafted from the facts and the form's context.
- **Storage.** In this browser (`bolbharo.profile.v1`), and in your account when sync is on. The side panel runs the app in an iframe with its own storage, so it keeps a separate copy: use **Profile, Export JSON** here and **Import JSON** there.
- **Screens.** `/?` **Set it up** (landing card, or the side panel's start screen), the onboarding flow, and **Profile** (facts by section, edit, remove, OK to autofill, export, import, delete all). Routes: `app/api/onboard/github` (GitHub public data) and `app/api/onboard/extract` (quoted facts). Code: `lib/profile-keys.ts` (checklist, keys, sections), `lib/profile-gaps.ts` (gaps and the onboarding session), `lib/profile-extract.ts` and `lib/profile-ground.ts` (extraction and the quote guard), `lib/github.ts`, `lib/onboard-client.ts`, `components/profile/*`.

Not done: LinkedIn is never fetched by the server. Matching is by question wording and canonical key, so an unusual form label may still be asked. A fact's value is checked for its quote, not that the quote supports the value (the same limit as interview answers).

## Scoreboard

`npm run eval` plays one simulated applicant against two interviewers and grades both. The applicant (Groq) knows eight facts about a pharmacy stock app, a hackathon result, a team he led and why he wants the role, and gives each up only when a question asks for that detail. The **form-reader** asks each form question word for word and keeps the first answer. **Apply करो** is the real ElevenLabs agent in text mode, running the real client tools, quote guard and open-slot check. Both sets of facts go through the same `draftAnswer`, with the same notes on each question, and a Groq judge that is not told which tool wrote what scores facts recalled (of 8), answer quality (1 to 5, long answers) and invented claims.

The result is written to `data/eval.json` and shown at `/scoreboard` in the same visual language as the app. The page reports whatever the file says, a bad run included.

Read the numbers with these limits in mind: one model family plays the applicant, drafts and judges; the plan is the hand-written demo plan, not one generated from a form; a handful of runs shows the size of a gap, not a significance test; and the baseline asking each label once is deliberately naive.

**Last run (18 Oct 2026, 5 runs, none failed).**

| | Form-reader | Apply करो |
| --- | --- | --- |
| Facts recalled, of 8 | 0 (every run) | 5.2 (best 6, worst 4) |
| Answer quality, 1 to 5 | 2 | 4.5 |
| Invented claims per run | 0 | 0 |
| Turns | 6 | 13.6 (all 5 interviews finished) |

Apply करो reliably drew out the facts it asked for directly: what the person built, who used it and what changed, and the team he led and how it ended (4 or 5 runs of 5 each). The prompt makes it ask once more after a vague answer to an open question. That moved what the app does from 0 of 5 runs to 4 of 5 (the run before that change scored 4.6 of 8 with 13.4 turns and 0 invented). Two facts are still missing: why he wants the role (0 of 5) and the hackathon result (0 of 5, hinted at in one run). On those the agent still accepts a feeling ("I'm proud of creating something useful", "I like building things that help small businesses") as an answer and moves on. To try again: change `AGENT_SYSTEM_PROMPT`, run `npm run configure:agent`, then `npm run eval`.

The form-reader's 0 is by construction: it asks "Tell us about something you've built" once and gets a one-line answer. Read it as the cost of not interviewing, not as a tuned opponent. The simulated applicant is also strict, so the absolute recall figures say more about the agent's follow-up habits than about real people.

## Hindi and Hinglish

The language switch on the landing page now goes all the way through. Choose **हिन्दी** and the Demo tab gives a Hindi version of the same form (its own questions and its own scripted interview), the agent greets and asks in Devanagari, keeps English words as people say them, and the quote guard works on whatever script the person used. Drafts are written in the language of the question.

How it is wired: `npm run configure:agent` turns on the agent's `hinglish_mode`, adds a `hi` language preset and lets the browser choose the language; the app then starts a Hindi session with `overrides.agent.language = "hi"`. The greeting and the language instruction travel as dynamic variables (`greeting`, `language`), so one first message and one prompt serve both languages. Re-run `configure:agent` once to apply this to an existing agent.

What has been tested, and what has not:

- **Tested:** the live agent in Hindi over text (`npm run smoke:agent -- --hi`): replies in Devanagari, quotes copied exactly, including a reply typed in Roman-script Hinglish. The agent's own speech recognition on synthetic speech (`npm run check:speech`): Hindi sentences came back word for word apart from English loanwords, which the recogniser writes in Latin letters (WhatsApp, bot), and numbers as digits; Roman-script Hinglish came back in Devanagari with the English words kept.
- **Not tested:** a real human voice, regional accents, a noisy room, or how the agent's voice sounds in Hindi (the default voice is an English one; pick a Hindi-capable voice in the ElevenLabs dashboard and listen first).

## Demo kit and recorded fallback

[docs/DEMO.md](docs/DEMO.md) has a timed three-minute script, a cue sheet for playing the applicant, the talk track and a what-to-do-when-it-breaks table.

For when Wi-Fi or a service fails, `/?replay=1` replays the scripted interview with large captions for both sides and finishes in the review screen with answers written in advance, so it needs only the local server. Add `&lang=hi` for the Hindi form and `&speed=2` for double speed. The landing page links to it from the Demo tab and from the "Couldn't reach the server" error.

When something fails live, the Talk panel says why and offers the way out: a blocked microphone offers typing, a refused or unreachable voice service offers a retry or the recorded demo, a missing agent links to the setup guide.

## Deploy (Vercel)

1. Push the repo to GitHub and import it in Vercel. Framework preset: Next.js. The defaults are right.
2. In **Settings, Environment Variables**, add for Production and Preview: `GROQ_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_API_KEY`, and optionally `GROQ_MODEL`. For Google sign-in also add `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` (and `DATABASE_URL` to sync facts), and add your domain under Neon Auth's trusted domains.  Keys go in the Vercel dashboard only: never commit them, never prefix them with `NEXT_PUBLIC_`.
3. Deploy, then open `/api/health`. Expect `{"llm":true,"voice":true,"voicePrivate":true}`.
4. `data/eval.json` is committed, so `/scoreboard` has numbers on the deployed site (`next.config.ts` makes sure the file ships with the server). To refresh it, run `npm run eval` locally and commit the file.

### Make the agent private

A new agent is public: anyone who finds its id can start conversations on your ElevenLabs account. Before the URL goes anywhere:

1. In the ElevenLabs dashboard, open the agent's security settings, turn on authentication, and add your deployed domain to the allowlist. (Dashboard labels move around; in the API this is the `platform_settings.auth` section of the agent.)
2. Keep `ELEVENLABS_API_KEY` set on the server. `/api/voice/session` then returns a short-lived WebRTC token (falling back to a signed WebSocket URL) and the key never reaches the browser. With the key unset, the route returns the bare agent id, which a private agent will refuse. The app shows that as "ElevenLabs refused the connection".
3. Check it: `curl https://your-app.example/api/voice/session` should show `"mode":"token"`, not `"public"`.
4. Set a spending limit on the ElevenLabs account. The token route is open to anyone who can load the page, so for a demo that is not meant to be public, also turn on Vercel's Deployment Protection.
5. `smoke:agent`, `eval` and `check:speech` ask for a signed URL when `ELEVENLABS_API_KEY` is set, so they keep working once the agent is private.

Checked here: with `ELEVENLABS_API_KEY` set, `/api/voice/session` returns `mode: "token"`. Not tried: a private agent. The agent this repo was built against is still public, and no Vercel deploy has been done.

## Design

Palette sampled from the reference: forest `#081800`, tiles `#131e09` / `#192d0b`, lime `#e0f16e` / `#daed72` / `#cae23d`, cream `#e9f8b8`, olive `#648600`. Archivo throughout (variable weight and width: wide and heavy, in capitals, for display type) with Geist Mono for small labels. Corners are 2px everywhere and there are no italics. Lime blocks carry the key numbers and the main form card, frosted glass panels sit over a slow noise shader, and the voice orb is a second shader ringed by a live frequency dial. Dark is the default, light is a toggle (or press `d`). Motion uses anime.js and respects `prefers-reduced-motion`.

## Finding the details, and matching them to a form

Onboarding finds a person's contact details and links by pattern first (`lib/profile-patterns.ts`: email, phone, LinkedIn, GitHub, the name at the top of the resume, a labelled city), each quoted exactly, so they never depend on the model. The model then reads the rest and is told to return every canonical field the text states (name, college, degree, branch, graduation year, CGPA, skills, every job and project). A kept resume can be read again from the Profile screen with the current reader.

At form time a question is matched to a saved fact by its meaning. Free matching covers common wording (`lib/profile-keys.ts`: "Mobile No.", "Institute", "Passing year"...) and first and last name from the full name; the model matches the rest and may return a part of a fact (a first name, a year, the digits of a phone number) which is accepted only if every word and number in it is in the fact (`derivedValue`). One fact can fill several questions.

## Ready before answering

Before any answer is filled, one model call (`/api/readiness`, `lib/readiness.ts`) checks each question of the form: is it understood, and is there enough (the saved profile, the form's notes) to answer it. A question that is unclear or missing something shows "Needs" or "Unclear" in the Plan, is marked `not ready` in the plan the agent gets (so it asks about exactly that first), and is held back from Autofill. The agent's context also carries a digest of what is already known about the person (`lib/profile-digest.ts`: resume, GitHub, earlier forms), as background only; it still cannot record any of it as something they said. A failed check never blocks the interview.

The resume file is kept in this browser (IndexedDB, `lib/resume-store.ts`) and shown on the Profile screen and after onboarding, with View, Download and Remove. It is not uploaded for storage.

## Autofill and the resume

In the side panel, **Autofill** reads the page and types what the saved profile already answers into it, with no interview (`autofillPayload` in `lib/page-form.ts`). Details read from a resume are used for this but are never listed on the Profile screen or in the onboarding review: they are saved with `hidden: true` (export and import keep them). GitHub and LinkedIn facts stay visible.

## GitHub projects

Optional. Connect a GitHub account on the Profile screen (or in onboarding) and Apply करो reads every repo it can see, private ones included, using GitHub's device flow (`lib/github-device.ts`, `/api/github/device` and `/api/github/poll`): a short code, no redirect, no client secret, so it works in the side panel as well. The token and the repo index (`lib/github-client.ts`, `lib/repos.ts`) stay in this browser and only go to api.github.com.

How it is used: when the interviewer connects, it is told which projects you have. When you describe or name one, the sentence is matched to a repo (named outright, or two shared words with its description). That repo's README, languages and your commit count are read once a day, turned into quote-checked facts by the same extraction as onboarding, and the model picks which of the open questions they answer (it returns only indexes, so nothing is invented). Those answers are saved as "to confirm", the agent is told to say them back in one sentence and ask only what is still open. Two repos that fit means it asks which.

Forms read in the extension use the saved profile and the facts from every earlier form you approved (remembered by default in the side panel). Confirmed, non-sensitive facts fill as answered; answers about why this company or role, and sensitive facts, are only offered. Needs `GITHUB_CLIENT_ID` (see `/setup`, step 07). Caveat: an OAuth app can only see private repos through the `repo` scope, which can also write; the app only reads.

## Browser extension (side panel)

`extension/` is a Chrome extension that reads the form on any page (Google Forms, Microsoft Forms, a company's own site) and fills it in after approval. It opens in Chrome's side panel, frames this app, and talks to it with checked `postMessage`s. Source `page` in `/api/ingest` turns the questions it read into an interview. See `extension/README.md` for install, permissions and limits. Not yet tried: a real Google or Microsoft form, and the microphone inside the side panel.

## Google sign-in, saved facts and your forms

Optional. The app works without it.

**Sign-in is Neon Auth** (managed Better Auth, in the same Neon project as the database). `lib/auth/server.ts` creates it, `app/api/auth/[...path]` proxies its API, `proxy.ts` finishes the Google round trip, and `lib/identity.ts` says who is signed in. Google works at once with Neon's shared dev credentials (the consent screen then shows Neon's name). For production add your own Google client in Neon's Auth settings.

With a database (`DATABASE_URL`) two things are kept in the account whenever the person is signed in, always, with no switch:

1. **Saved facts**, with the words they came from, keyed by their Neon Auth user id, so every device has them. The server keeps the newest fact per question (`/api/profile`, `lib/profile-store.ts`).
2. **Every form they approve**, with its questions and their answers (`/api/history`, `lib/history*.ts`, table `filled_forms`). The **Dashboard** (account menu, or the landing nav) lists them and opens each one. Forms are also kept on the device, so signed out they still show; signing in uploads them. Onboarding and the demos are not recorded, and only the form's origin and path are kept, not its query string.

The account menu (photo) holds Your profile, Dashboard, Delete what is in my account, and Log out. State-changing routes also check the `Origin` header. Setup steps are on `/setup`, step 06.

Privacy: signed out, nothing about the person is stored by Apply करो beyond the sign-in itself (Neon Auth keeps the account). Signed in, their facts and filled forms (answers included) are in the database you configure.

## Environment

Copy `.env.example` to `.env.local`.

| Variable | Needed for |
| --- | --- |
| `GROQ_API_KEY` | Reading your own forms, drafts, rewrites, saved-fact matching |
| `ELEVENLABS_AGENT_ID` | The live voice agent |
| `ELEVENLABS_API_KEY` | Optional: private agent (short-lived tokens) |
| `GROQ_MODEL` | Optional: defaults to `openai/gpt-oss-120b` |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | Optional: Google sign-in through Neon Auth. The secret is 32 or more random characters |
| `GITHUB_CLIENT_ID` | Optional: connect a GitHub account (device flow, no secret). Enable Device Flow on the OAuth app |
| `DATABASE_URL` | Optional: a Postgres connection string, to sync saved facts |
| `GITHUB_TOKEN` | Optional: a GitHub token with no scopes, to raise GitHub's rate limit for onboarding |

## Phases

**Phase 1: done.** Scaffold, design system, landing and workspace, intent-graph ingest, ElevenLabs client tools, quote guard, text and demo modes, setup page.

**Phase 2: done.** Drafts, review with quotes, edit by text or voice, approve, hand-over (prefilled Google Form link, copy, JSON), saved profile with confirmation, Groq in place of Gemini, the palette, Archivo, shaders and glass redesign.

**Phase 3: done.** The scoreboard (`npm run eval`, `/scoreboard`), Hindi and Hinglish end to end with a Hindi demo form, the demo kit and recorded fallback, error and empty states for the microphone, the network and ElevenLabs, a keyboard and focus pass, and the Vercel and private-agent notes.

**Extras: done.** Resume where you left off, time saved on the hand-over screen, a second demo form (a kirana owner's working-capital loan, spoken in Hindi), the answer-strength meter, and resume upload (PDF, text or paste). `tests/features.test.ts` covers them.

**Google sign-in: done.** Sign in with Google through Neon Auth, saved facts and every approved form kept in the account, and a Dashboard of filled forms.

**Not done:** a visible-browser fill for forms that can't be prefilled by link, an India data residency option, a real Vercel deploy.

## Not yet verified against live services

Built from the installed SDK types and docs; the Groq calls were exercised for real (drafting and rewriting), the rest was not:

- A real Google Form (the parser is tested on a synthetic page with the documented layout; paste mode is the fallback). The prefilled-link builder is unit-tested but not opened against a live form.
- A live ElevenLabs agent confirming saved facts from an earlier form. (Dynamic variables, the three tool names, Hindi in text and Hindi speech recognition on synthetic speech were exercised in Phase 3: see above.)
- Resume upload: a real PDF went through the real route and real Groq extraction (on `openai/gpt-oss-20b`, because the 120b daily token quota had been spent by eval runs), and the quote check dropped a quote that was stitched across two sentences. The browser flow ran with the facts route mocked for the same reason. Not tried: a scanned PDF, a resume in Hindi, a two-column layout.
- Google sign-in: Neon Auth is provisioned and the page reaches Google's sign-in through it (checked in a browser), but a full sign-in with a real Google account has not been completed here. The account routes (facts, forms) were tested with the identity mocked, and the stores' SQL against the real Neon database for facts only: the `filled_forms` table has not been run against a live database.
- Real voices: Hindi speech from a person, accents and noise, and how the agent's voice sounds. The microphone path in the browser was checked only as far as the blocked-microphone state.
