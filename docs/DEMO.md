# Demo kit: three minutes

One run-through, a talk track, and what to do when something breaks. Everything on screen comes from the app. The numbers come from `/scoreboard`, which reads a real run: read them off the page, do not quote them from memory.

## Before you go on (five minutes)

1. `npm run build && npm start` (or `npm run dev`). Port 3100.
2. Open four tabs, in this order:
   - `http://localhost:3100/`: the live demo. Dark theme (press `d` to toggle).
   - `http://localhost:3100/?replay=1&speed=2`: the recorded fallback. It starts replaying the moment the page loads, so it will have finished by the time you need it: **reload it (Ctrl+R) when you switch to it**.
   - `http://localhost:3100/scoreboard`: the numbers.
   - `http://localhost:3100/?replay=1&lang=hi&speed=2`: the Hindi replay. Reload it the same way.
3. Check the status row at the foot of the landing page: **Form reader ready, Voice agent ready**. If either says "needs", skip the live part and use the replay.
4. Click once in the live tab and allow the microphone. Say a sentence and watch the orb move.
5. Run `npm run eval` the day before so the scoreboard shows a fresh run, and read the page once so nothing surprises you.
6. Close notifications. Headphones off, speakers on, volume at half.

## The three minutes

| Time | On screen | You do and say |
| --- | --- | --- |
| 0:00 | Landing | Hook. "Every application form asks for something specific and gets something vague. Apply करो interviews you out loud until the answer is specific, and shows the words behind every line." |
| 0:20 | Landing, Demo tab | Pick **Demo**, English, **Start the interview**. "This is a real product-engineer application. Nothing is submitted without me." |
| 0:30 | Talk panel | **Start talking.** Answer as Asha (cue sheet below). First answer is deliberately vague: "I built a chatbot." Let the agent probe. |
| 1:10 | Plan and Evidence panels | Point at the chips filling and at the quote beside each fact. "It only keeps what I actually said." |
| 1:20 | Talk panel | "To save time, here is the same interview recorded." Switch to the **replay tab** and reload it (Ctrl+R). It runs by itself, about 40 seconds at 2×, while you talk. |
| 1:30 | Evidence, Guard tab | When the **1 blocked** appears: "The agent just tried to write down '90,000 users'. Nobody said that. The guard blocked it." |
| 1:55 | Review panel | The interview ends by itself. "Every answer is drafted only from my facts. Edit by hand, or say 'make it shorter'." Open **Based on N facts** on question 3 to show the quotes. |
| 2:15 | Review, **Approve** | Press **Approve**. "A Google Form opens pre-filled and I press Submit. Anything else is copy and paste." |
| 2:25 | Scoreboard tab | "Same simulated applicant, two interviewers: one asks the form's questions word for word, one is Apply करो's real agent. Facts kept, answer quality, invented claims." Read the three big numbers off the page. Then the caveat: "One model plays the applicant, so this is a measured gap, not a proof." |
| 2:45 | Hindi replay tab | "And it works in Hindi." Show the Devanagari captions for ten seconds. |
| 2:55 | Landing | Close. "Speak, and it fills the form." |

If you are short of time, drop the Hindi tab. If you have an extra minute, do the review edit by voice.

### Cue sheet for the live part

You play Asha Patil. Reveal one fact per question and stay a little vague, like a real applicant.

| Asked about | Say |
| --- | --- |
| Name, city | "Asha Patil, in Pune." |
| What you built | "I built a chatbot." (then, when asked who for) "A WhatsApp ordering bot for kirana stores in Pune." |
| Your part | "I wrote the whole backend myself, in Python. Two interns helped with the UI." |
| Who used it, what changed | "About thirty shop owners. Taking an order went from six minutes to one." |
| A number | "About four hundred orders a week." |
| Proudest achievement | "Winning the college innovation award in 2025." |
| What it changed | "Honestly, not much. Skip that one." |
| Leading others | "I split the UI in two, reviewed their pull requests every day, and we shipped in eight weeks." |
| Why this role | "I like fintech problems for small businesses, and I've already built for them." |

The agent words its questions differently each time. Answer what it asks.

## Extra beats (use one or two, 20 seconds each)

| Beat | Do | Say |
| --- | --- | --- |
| Refresh safety | Mid-interview, press F5. The landing page shows **Where you left off**. Press **Resume**. | "A refresh or a crash does not cost the interview. It is saved on this device only." |
| Second form | Landing, **Demo**, **Merchant loan**, Start. The language switches to Hindi by itself. **Watch the demo**. | "Same engine, different form: a kirana owner asking for a working-capital loan, in Hindi. The guard blocks an invented sales figure here too." |
| Your resume | Before starting, press **Upload PDF** and pick a resume. Start. Chips arrive marked **from resume.pdf**. | "It reads the resume once, keeps a quote for each fact, and asks me only about what is missing. I still say yes to each fact." Needs a Groq key. |
| Private form | Sign in with Google, open the account menu, **Connect** Google Forms (needs your own Google client), then paste the **edit** link of a form you own that is not public. | "This form is not open to anyone. I signed in, and it reads it with my own Google access, read-only." Needs the Forms setup done first (`/setup`, step 06), and that account added as a Google test user. |
| Time saved | On the hand-over screen of a live (not scripted) interview. | "Done in 3:12. Typing this would take about this long." Say it is an estimate: 40 words a minute plus thinking time. |

The scripted demo and replay show only the typing side of the time box, because they have no real speaking time. Do not read a "time saved" number off a scripted run.

## Talk track

**The problem (30 seconds).** Forms are written for the form owner's benefit and answered under pressure. "Tell us about something you've built" gets "I built a chatbot" because the applicant does not know what a good answer contains. A chat assistant that rewrites the answer makes it worse: it makes things up. Writing a polished lie is easy. Drawing out the true detail is the hard part.

**What it does differently.**
- It reads the form and works out what each question is really after, then plans the facts a strong answer needs.
- It interviews by voice and keeps probing until each fact is specific. One answer can fill several questions; it never asks twice.
- Every fact is saved with the words the person said. A value whose quote was not said is rejected before it reaches a draft. This is the anti-hallucination guard, and it is code, not a prompt.
- Drafts are written from those facts only. A number nobody said is flagged for review.
- The person approves, and submits themselves.

**The scoreboard (what to say and what not to).** Say: "We measured it. Same simulated applicant who knows eight facts and gives each up only when asked directly. The form-reader asks every question as written and keeps the first answer. Apply करो is the live agent." Read the page. Then be honest: the applicant, the drafter and the judge are the same model family, a handful of runs shows the size of a gap rather than a test of significance, and the plan is the hand-written demo plan. If a run looks bad, say so and show it. The page reports whatever the last run measured.

**Hindi.** "Hindi is a first-class language, not a translation layer. The Hindi demo form has its own questions and its own scripted interview. The agent answers in Devanagari, keeps English words as people say them, and the guard works the same way." What has been tested: the live agent in Hindi over text, and its speech recognition on synthetic Hindi and Hinglish speech (`npm run check:speech`). What has not: a real voice, an accent, a noisy room. Do not claim those.

**Privacy.** The conversation goes to ElevenLabs, and the form text and the person's facts go to Groq to read the form and write drafts. By default Apply करो keeps nothing on its own server; ElevenLabs and Groq handle the data under their own retention settings, so check those before a real deployment. Saved facts live in this browser, behind a switch the person controls, and can be forgotten from the landing page or the review screen. Only if the person signs in with Google and turns on sync do the facts, with their quotes, go to the database you configured; that switch is off by default and has its own delete button. Say it that way if asked.

### Questions you will get

- **Why not just ask ChatGPT to fill the form?** It fills the form from nothing, so it invents. Here every line sits beside the sentence the person said.
- **What if the voice agent mishears?** The quote is checked against the transcript, and the person sees the quote and the value side by side before approving.
- **What stops it submitting by itself?** There is no submit path. A Google Form opens pre-filled and the person presses the button.
- **Does it work offline?** The recorded replay does (`/?replay=1`). Live voice needs ElevenLabs.
- **What does a call cost?** The agent uses a small fast model. Text mode is cheaper than voice. Set a spending limit on the ElevenLabs account and make the agent private before deploying (see the README).

## When something breaks

| What you see | Do this |
| --- | --- |
| Status row says voice or form reader "needs" something | Skip the live part. Use the replay tab. |
| **The microphone is blocked** | Press **Type instead**. The interview works the same by typing. Say "my laptop mic is blocked, typing instead." |
| **ElevenLabs refused the connection** or a quota error | Press **Watch the recorded demo**, or open `/?replay=1`. |
| **Can't reach the voice service** (Wi-Fi) | Open `/?replay=1&speed=2`. It needs only the local server, and its drafts are written in advance. |
| Drafts look like plain joins of the facts | Groq is down or rate-limited. Carry on: the facts and quotes are the point. In the replay this cannot happen. |
| Agent keeps asking the same thing | Answer once more, shortly. If it persists, switch to the replay. |
| The page looks broken | Reload. If it is still wrong, use the replay tab you opened earlier. |
| Scoreboard says "No scoreboard yet" | `npm run eval` has not been run on this machine. Run it before the demo (about five minutes), not during. |

Replay options: `?replay=1` English, `&lang=hi` Hindi, `&speed=2` double speed. The replay shows large captions for both sides because it has no audio.
