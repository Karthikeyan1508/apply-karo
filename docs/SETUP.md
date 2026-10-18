# Setup: keys and the voice agent

The demo form needs nothing. For your own forms and a live agent you need a Groq key and an ElevenLabs agent. Allow about ten minutes. The same steps, with copy buttons for the prompt and tools, are at `/setup` in the running app.

## Where keys go

Put keys in **`.env.local`** (copied from `.env.example`). It is gitignored. `.env.example` is committed, so it must stay blank.

## 1. Groq key (reads forms, writes drafts)

1. Open https://console.groq.com/keys and sign in.
2. Create an API key and copy it.
3. In `.env.local` set:

   ```
   GROQ_API_KEY=your-key
   ```

The default model is `openai/gpt-oss-120b`, which supports strict JSON output. Set `GROQ_MODEL=openai/gpt-oss-20b` for more speed. Other models fall back to plain JSON mode.

## 2. ElevenLabs voice agent

### Automatic (recommended)

1. Create an agent in the ElevenLabs dashboard (any name; a blank one is fine).
2. In ElevenLabs, create an API key with access to Agents, and copy the agent's ID.
3. Put both in `.env.local`: `ELEVENLABS_API_KEY=` and `ELEVENLABS_AGENT_ID=`.
4. Run `npm run configure:agent`. It sets the system prompt, first message, dynamic variables, a fast model, the three client tools and Hindi support (see below), then verifies them. Add `-- --dry` to preview.
5. Run `npm run smoke:agent`. It talks to the agent in text mode and checks that it saves each answer with a quote the user really said. `npm run smoke:agent -- --hi` does the same in Hindi.

Re-run `configure:agent` whenever you change `lib/agent-prompt.ts`.

### By hand

1. Sign up at https://elevenlabs.io and open the **Agents** section.
2. Create an agent from a blank template. Name it Apply करो.
3. **LLM:** pick a fast Flash or mini model. High reasoning settings slow down turn-taking.
4. **Voice:** pick one you like. For Hindi, choose a multilingual voice and play a sample first.
5. **First message** and **system prompt:** copy both from `/setup` (they come from `lib/agent-prompt.ts`).
6. **Tools:** add three **client tools**. The names must match exactly (case-sensitive).

   | Name | Wait for response | Parameters |
   | --- | --- | --- |
   | `record_answers` | OFF | `updates`, string, required |
   | `finish_interview` | ON | none |
   | `edit_answer` | ON | `field`, string, required; `instruction`, string, required |

   Use the descriptions shown at `/setup`.
7. **Dynamic variables:** add `form_title`, `greeting`, `plan`, `context`, `language`, `first_question`. Give each a default value (shown at `/setup`) so the dashboard's test panel works. The first message is `{{greeting}} {{first_question}}`.
8. Copy the **Agent ID** into `.env.local`:

   ```
   ELEVENLABS_AGENT_ID=agent_xxxxxxxx
   ```

Dashboard labels change over time, so a button may be worded slightly differently from the steps above.

### Hindi and Hinglish

`configure:agent` does all of this. By hand:

1. In the agent's settings turn **Hinglish mode** on (`conversation_config.agent.hinglish_mode`). It lets a Hindi agent keep English words, the way people speak.
2. Add **Hindi** as an additional language, which creates a `hi` language preset.
3. In the Security tab, allow the client to **override the language**. Without this the agent ignores the language the app asks for and answers in English.
4. Make sure the voice you chose speaks Hindi (a multilingual voice), and play a sample.

Then check it:

- `npm run smoke:agent -- --hi` talks to the agent in Hindi over text.
- `npm run check:speech` streams synthetic Hindi and Hinglish speech into the agent and prints what its speech recognition heard. It proves the recogniser is set to Hindi. It does not prove anything about a real voice, an accent or a noisy room: try those yourself.

## ElevenLabs MCP

`.mcp.json` registers the official ElevenLabs MCP server. It runs through `scripts/elevenlabs-mcp.mjs`, which reads `ELEVENLABS_API_KEY` from `.env.local`, so the key is never written into the config. It needs `uv` (https://docs.astral.sh/uv/). In Claude Code, approve the project MCP server when asked. It exposes `list_agents`, `get_agent`, `simulate_conversation`, `get_conversation`, text to speech, voice search and more. It cannot update an agent, which is why `configure:agent` uses the REST API.

## 3. Restart and check

1. Stop the dev server and run `npm run dev` again so it reads `.env.local`.
2. Open http://localhost:3100/setup. The first two statuses should say ready.
3. Choose the demo form, then **Start talking**. Allow the microphone when the browser asks.

## 4. Optional: private agent

By default the browser connects with just the agent ID, so anyone who finds it can use your minutes. The README has the full Vercel and private-agent steps. In short, before deploying:

1. Turn on authentication for the agent in the dashboard.
2. Create an API key in ElevenLabs and set `ELEVENLABS_API_KEY=` in `.env.local`. The server then gives the browser a short-lived token and the key never leaves the server.
3. Set a spending limit on your account.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Start talking is greyed out | `ELEVENLABS_AGENT_ID` not set, or the server wasn't restarted |
| Agent talks but chips never fill | Tool names don't match exactly, or `record_answers` isn't added to the agent |
| Agent repeats questions it already asked | Dynamic variables aren't reaching the prompt: check `{{plan}}` appears in the system prompt |
| "quote not found" blocks everything | The agent is paraphrasing quotes: re-check the "Saving what you hear" section of the prompt |
| Agent never finishes | `finish_interview` isn't set to Wait for response, so it never sees what's still open |
| Voice edits during review do nothing | `edit_answer` isn't added as a client tool with Wait for response ON |
| Hindi session answers in English, or the call errors on start | The language override isn't allowed or the `hi` preset is missing: run `npm run configure:agent` again |
| Speech in Hindi comes back as English letters or gibberish | The agent's language isn't switching: check `npm run check:speech`, then the language override above |
| Drafts are plain joins of your words | `GROQ_API_KEY` missing, or the server wasn't restarted |
| "Groq rejected the API key" | The key in `.env.local` is wrong or revoked |
| Google Form can't be read | The form isn't open to anyone with the link, or Google changed its page format: use the Paste tab |
| Page looks unstyled or shows another app | A service worker from another app on the same port: use port 3100 (the default here) or clear site data |
