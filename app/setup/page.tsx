import { ArrowLeftIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { Logo } from "@/components/brand/logo"
import { CopyButton } from "@/components/copy-button"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  AGENT_FIRST_MESSAGE,
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOLS,
  DYNAMIC_VARIABLE_DEFAULTS,
} from "@/lib/agent-prompt"
import { formsConfig } from "@/lib/auth"
import { neonAuth } from "@/lib/auth/server"
import { profileStore } from "@/lib/profile-store"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Setup | Apply करो" }
export const dynamic = "force-dynamic"

function Status({ ok, title, hint }: { ok: boolean; title: string; hint: string }) {
  return (
    <div className="glass rounded-xl p-5">
      <p className="label-caps flex items-center gap-2 text-muted-foreground">
        <span className={cn("size-1.5 rounded-none", ok ? "bg-brand" : "bg-destructive")} />
        {ok ? "Ready" : "Not set"}
      </p>
      <p className="mt-2 text-sm font-semibold">{title}</p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <CopyButton text={text} />
      </div>
      <pre className="max-h-80 overflow-auto rounded-xl border bg-foreground/[0.05] p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
        {text}
      </pre>
    </div>
  )
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <p className="display text-5xl text-transparent [-webkit-text-stroke:1.5px_var(--brand)]">{n}</p>
      <h2 className="mt-3 text-2xl font-bold tracking-tight">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-muted-foreground [&_a]:font-semibold [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded-md [&_code]:bg-foreground/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground [&_li]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5">
        {children}
      </div>
    </section>
  )
}

export default function SetupPage() {
  const llm = Boolean(process.env.GROQ_API_KEY)
  const voice = Boolean(process.env.ELEVENLABS_AGENT_ID)
  const priv = Boolean(process.env.ELEVENLABS_API_KEY)
  const auth = Boolean(neonAuth())
  const forms = auth && Boolean(formsConfig())
  const sync = auth && Boolean(profileStore())

  const toolsText = AGENT_TOOLS.map(
    (t) =>
      `Name: ${t.name}\nWait for response: ${t.waitForResponse ? "ON" : "OFF"}\nDescription: ${t.description}\n` +
      (t.parameters.length
        ? t.parameters
            .map((p) => `Parameter: ${p.name} (${p.type}, ${p.required ? "required" : "optional"})\n  ${p.description}`)
            .join("\n")
        : "Parameters: none")
  ).join("\n\n")

  const varsText = Object.entries(DYNAMIC_VARIABLE_DEFAULTS)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n")

  return (
    <div className="relative min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-none px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" /> Back to the app
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-6 pb-24">
        <h1 className="display text-7xl">Setup</h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          The demo form works with no keys. To read your own forms and talk to a live agent you
          need a Groq key and an ElevenLabs agent. About ten minutes.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Status ok={llm} title="Form reader and drafts" hint="GROQ_API_KEY" />
          <Status ok={voice} title="Voice agent" hint="ELEVENLABS_AGENT_ID" />
          <Status ok={priv} title="Private agent (optional)" hint="ELEVENLABS_API_KEY" />
          <Status ok={auth} title="Google sign-in (optional)" hint="NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET" />
          <Status ok={forms} title="Private forms (optional)" hint="GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_SECRET" />
          <Status ok={sync} title="Synced facts (optional)" hint="DATABASE_URL" />
        </div>

        <Step n="01" title="Groq key (reads forms, writes drafts)">
          <ol>
            <li>
              Open <a href="https://console.groq.com/keys">console.groq.com/keys</a> and sign in.
            </li>
            <li>Create an API key and copy it.</li>
            <li>
              Copy <code>.env.example</code> to <code>.env.local</code> and set{" "}
              <code>GROQ_API_KEY=</code>. Keep the key out of <code>.env.example</code>: that file
              is meant to be committed.
            </li>
          </ol>
          <p className="mt-3">
            The default model is <code>openai/gpt-oss-120b</code>. Set <code>GROQ_MODEL</code> to
            change it, for example <code>openai/gpt-oss-20b</code> for more speed.
          </p>
        </Step>

        <Step n="02" title="ElevenLabs voice agent">
          <p>
            Fastest: with <code>ELEVENLABS_API_KEY</code> and <code>ELEVENLABS_AGENT_ID</code> in{" "}
            <code>.env.local</code>, run <code>npm run configure:agent</code>. It sets the prompt,
            first message, variables, model and all three tools, then checks them. After that,{" "}
            <code>npm run smoke:agent</code> talks to the agent in text mode to confirm it saves
            answers with real quotes (add <code>-- --hi</code> for Hindi).
          </p>
          <p className="mt-3">Or by hand:</p>
          <ol className="mt-2">
            <li>
              Sign up at <a href="https://elevenlabs.io">elevenlabs.io</a> and open the Agents section.
            </li>
            <li>Create an agent from a blank template and name it Apply करो.</li>
            <li>
              Pick a fast Flash or mini model for the agent&apos;s LLM. Avoid high reasoning
              settings, which slow down turn-taking.
            </li>
            <li>Pick a voice you like. For Hindi, choose a multilingual voice and play a sample first.</li>
            <li>Paste the first message and the system prompt below.</li>
            <li>
              Add the three client tools below. The names must match exactly. Turn Wait for
              response ON only where shown.
            </li>
            <li>
              Add the dynamic variables below with their default values, so the agent also works
              in the dashboard&apos;s test panel.
            </li>
            <li>
              Copy the agent&apos;s ID into <code>.env.local</code> as <code>ELEVENLABS_AGENT_ID=</code>.
            </li>
          </ol>
          <p className="mt-3">
            Dashboard labels change from time to time, so a button may be worded slightly
            differently from the steps above.
          </p>
          <Block title="First message" text={AGENT_FIRST_MESSAGE} />
          <Block title="System prompt" text={AGENT_SYSTEM_PROMPT} />
          <Block title="Client tools" text={toolsText} />
          <Block title="Dynamic variables (with default values)" text={varsText} />
        </Step>

        <Step n="03" title="Hindi and Hinglish">
          <p>
            <code>npm run configure:agent</code> also turns on Hinglish mode, adds a Hindi language
            preset and lets the app choose the language when it starts a session. By hand: turn on
            Hinglish mode, add Hindi as an additional language, and in the Security tab allow the
            client to override the language. Pick a voice that speaks Hindi and play a sample.
          </p>
          <p className="mt-3">
            <code>npm run check:speech</code> sends synthetic Hindi and Hinglish speech to the agent
            and prints what its speech recognition heard. It does not stand in for trying a real
            voice.
          </p>
        </Step>

        <Step n="04" title="Restart and check">
          <ol>
            <li>
              Stop the dev server and run <code>npm run dev</code> again so it reads{" "}
              <code>.env.local</code>.
            </li>
            <li>Reload this page. The first two statuses above should say ready.</li>
            <li>
              On the home page pick the demo form, then Start talking. Allow the microphone when
              the browser asks.
            </li>
          </ol>
        </Step>

        <Step n="05" title="Optional: make the agent private">
          <p>
            By default the browser connects with just the agent ID, so anyone who finds the ID can
            run up your usage. Before you deploy, turn on authentication for the agent in the
            dashboard and add an API key to <code>.env.local</code> as{" "}
            <code>ELEVENLABS_API_KEY=</code>. The server then hands the browser a short-lived token
            and the key never leaves the server. Also set a spending limit on your account.
          </p>
        </Step>
        <Step n="06" title="Optional: Google sign-in, private forms and synced facts">
          <p>
            Sign-in uses <a href="https://neon.com/docs/auth/overview">Neon Auth</a>. Signed in, the
            person can keep their saved facts in their account, and (with a Google client of your own)
            connect Google Forms so Apply करो can read a <em>private</em> form they own or can edit.
            Public forms and everything else work without any of this.
          </p>
          <ol className="mt-2">
            <li>
              Sign-in: in your Neon project, enable Auth (Better Auth) on the branch. Google works at
              once with Neon&apos;s shared credentials, which show Neon&apos;s name on the consent
              screen. Put the Auth URL in <code>.env.local</code> as <code>NEON_AUTH_BASE_URL=</code>
              and add <code>NEON_AUTH_COOKIE_SECRET=</code> with 32 or more random characters. Add your
              site&apos;s address (for example <code>http://localhost:3100</code>) under trusted
              domains. For production, add your own Google client ID and secret in Neon&apos;s Auth
              settings.
            </li>
            <li>
              Synced facts: put a Postgres connection string in <code>.env.local</code> as{" "}
              <code>DATABASE_URL=</code> (the same Neon database works). The table creates itself.
            </li>
            <li>
              Private forms (optional): in{" "}
              <a href="https://console.cloud.google.com/">Google Cloud Console</a> enable{" "}
              <strong>Google Forms API</strong>, set up the OAuth consent screen (External, add test
              users, add the scope <code>https://www.googleapis.com/auth/forms.body.readonly</code>),
              and create an OAuth client of type Web application with the redirect URI{" "}
              <code>http://localhost:3100/api/forms/callback</code>. Put the client ID and secret in{" "}
              <code>.env.local</code> as <code>GOOGLE_CLIENT_ID=</code> and{" "}
              <code>GOOGLE_CLIENT_SECRET=</code>, and add <code>AUTH_SECRET=</code> with 32 or more
              random characters (it encrypts the Forms connection cookie). Behind a proxy also set{" "}
              <code>APP_URL=</code>.
            </li>
            <li>Restart the dev server and reload this page.</li>
          </ol>
          <p className="mt-3">
            Good to know: the Forms API only opens forms the signed-in Google account owns or can edit,
            and needs the form&apos;s <em>edit</em> link (ending in <code>/edit</code>), not the share
            link. Neon Auth&apos;s sign-in cannot ask for the Forms permission, which is why connecting
            Forms is its own step with its own Google client. While that consent screen is in Testing,
            Google expires the connection after 7 days and shows an &quot;unverified app&quot; warning.
          </p>
        </Step>
      </main>
    </div>
  )
}
