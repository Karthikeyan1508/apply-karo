# Apply करो browser extension

Reads the form on the page you are on, any site, then interviews you in Chrome's side panel and fills the page in once you approve. It never presses Submit or Next.

## Install (developer mode)

1. Start the app: `npm run dev` (port 3100).
2. Open `chrome://extensions`, turn on Developer mode, press **Load unpacked**, pick this `extension/` folder.
3. Go to a page with a form, click the Apply करो icon (the side panel opens), press **Read this page**.
4. Talk or type the interview, review, press **Approve**, then **Fill this page**. Check the page and press its own Submit.

The panel frames the app at `http://localhost:3100`. Change the address under **App address** at the bottom of the panel, for example to your deployed app.

## Autofill

Press **Autofill** in the side panel: it reads the page, matches your saved profile and earlier approved forms, and types every answer it already knows into the page straight away. Sensitive facts, answers still waiting for your yes, and anything it has no fact for are left alone and nothing is submitted. **Read this page** is the other button: it opens the interview for the questions that are left.

## How it works

- `extract.js` runs in the page when you press Read. It finds the questions (standard controls, plus the ARIA roles Google Forms and Microsoft Forms use) and tags each with a `data-bolbharo-ref`. Nothing leaves the page except to the app you framed.
- `panel.js` sends that to the app (`bolbharo:form`). The app builds the interview from it (`/api/ingest`, source `page`).
- After approval the app asks the panel to fill (`bolbharo:fill`), and `fill.js` sets the values and fires the page's own input and change events.
- Messages are checked on both sides: the panel accepts only the framed app's origin, and the app accepts only the extension that framed it.

## Your profile in the side panel

The side panel keeps its own copy of the profile: its storage is separate from the normal site's, and sign-in does not reach the frame. Build the profile on the normal site, press **Profile, Export JSON**, then in the side panel press **Profile, Import JSON**. Once there, a form that is read is pre-filled from the profile, and only the questions the profile does not answer are asked. The side panel's start screen shows how many facts are saved.

## Permissions

`<all_urls>` so it can read the page you press Read on, and frames inside it. `sidePanel`, `scripting`, `storage`. It reads a page only when you press the button, and talks only to the Apply करो app.

## Limits

- It reads what is on screen. A multi-page form needs Read on each page (a new Read replaces the earlier one).
- Dropdowns that only draw their options when opened, and controls in closed shadow roots, are skipped. Questions asked as images, and file uploads, are not read.
- Heuristics, not per-site parsers, so odd markup can mislabel a question. Check the plan before the interview.
- Inside the panel the app is a third-party frame: sign-in and the saved facts of the normal site are not shared with it, and the side panel cannot show Chrome's microphone prompt. If the app says the microphone is blocked, press **Allow microphone** at the top of the panel once: it opens a normal tab that asks Chrome, and the allowance then covers the framed app. Text mode works regardless.
