# Site Bridge

Turn any website into an **agentic website**. Paste a URL and Site Bridge:

1. **Crawls** the public pages it can reach (robots.txt, sitemap.xml, navigation links), using open-source tools only.
2. **Understands** the site with one Gemini call: what the business does, key facts, offerings, FAQs, contact details and the tasks a visitor can do.
3. **Hands over three deliverables** for that site:
   - a **WordPress plugin** (`.zip`) that puts an AI agent on every page of the customer's site, plus a one-line script tag for any other website;
   - the **knowledge base** as Markdown or JSON, for chatbots, RAG pipelines, custom GPTs or help centres;
   - an **MCP endpoint** with one tool, `site_knowledge`, plus `llms.txt` and `agent.json`, for AI agents and pipelines.
4. Opens a **live demo**: the customer's real website with the agent docked at the side. The agent answers from the site's content and *operates the UI*: it opens pages, scrolls, highlights, clicks and fills forms, with a visible cursor.

Everything runs on one Node.js server. You bring your own accounts: a Gemini API key (required), a Vercel project with a Blob store (to host it), and optionally Supabase (usage tracking).

---

## Contents

- [How it works](#how-it-works)
- [Run it locally](#run-it-locally)
- [Deploy on Vercel](#deploy-on-vercel)
- [Connect Supabase (optional)](#connect-supabase-optional)
- [Access control](#access-control)
- [The deliverables](#the-deliverables)
- [Routes](#routes)
- [Code map](#code-map)
- [Configuration reference](#configuration-reference)
- [Guardrails and security](#guardrails-and-security)
- [Accounts and payments (dormant code)](#accounts-and-payments-dormant-code)
- [Known limits](#known-limits)

---

## How it works

```
                 ┌──────────────────────────────── Site Bridge server (server.js + lib/) ───────────────────────────────┐
Owner's browser ─┤ scan:  crawler.js ─► builder.js ─► Gemini (1 call) ─► search index ─► store.js (one JSON per site)  ├─► Vercel Blob / data/sites
  (app UI)       │                                                                                                     │
Customer website ┤ chat:  /api/chat ─► agent.js (Gemini function calling) ─► server tools + UI tools in the page      ├─► Gemini
  (widget.js)    │                                                                                                     │
AI agents (MCP) ─┤ mcp:   /mcp/<id> ─► mcp.js ─► site_knowledge                                                        │
                 │ files: /sites/<id>/wordpress.zip, knowledge.md/.json, llms.txt, agent.json  (package.js)           │
Demo visitors ───┤ demo:  proxy.js serves the real site on the demo host and injects bridge.js                       ├─► customer's real site
                 └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Scan.** `crawler.js` reads the site (same origin only, robots.txt respected, private addresses refused). `builder.js` sends one digest to Gemini, which returns a site profile (summary, facts, offerings, FAQs, contact, visitor tasks, suggested questions). A BM25 index (`search.js`) is built over the page text. The whole site is saved as one JSON file by `store.js`: in `data/sites/` locally, in Vercel Blob on Vercel.
2. **Chat.** The browser keeps the conversation and sends it to `/api/chat`. `agent.js` runs a Gemini function-calling loop. Knowledge tools (search, get page) run on the server; UI tools (navigate, click, fill, highlight, scroll) go back to the browser, which runs them in the page and returns the result. Every server turn is HMAC-signed so history can't be forged.
3. **Embed.** `widget.js` is the agent as a drop-in script. The WordPress plugin only prints that script tag in the site footer. The widget loads its settings from `/api/sites/<id>/public` and talks to `/api/chat`, both with open CORS.
4. **Live demo.** `proxy.js` is a reverse proxy that serves the customer's real site on a second address (the *demo host*), strips frame-blocking headers and injects `bridge.js`. The demo page shows it in a frame with the agent beside it. POST forms are blocked in demos so no real data is sent.

## Run it locally

Requires Node.js 20.12 or newer.

```bash
npm install
cp .env.example .env          # then set GEMINI_API_KEY
npm start                     # or: npm run dev  (restarts on changes)
```

Open http://localhost:4100, paste a website and scan it. Live demos run at `http://<site-id>.localhost:4101` (Chrome resolves `*.localhost` by itself).

- Without `GEMINI_API_KEY`, crawling, MCP, downloads and the demo still work; only the AI profile and the chat need it.
- Without `DEMO_PASSWORD`, the app is open. Set it in `.env` to test the password gate.
- Rate limits are skipped for requests from localhost.
- Scanned sites are saved in `data/sites/` (git-ignored).

## Deploy on Vercel

The repo is set up for Vercel's Express preset (`vercel.json`, region `bom1`). Deploys are made with the Vercel CLI or by connecting the GitHub repo to a Vercel project.

1. **Create the project.** `npm i -g vercel`, `vercel login`, then in the repo folder `vercel link` (create a new project).
2. **Add Blob storage.** Vercel dashboard → the project → Storage → Create → Blob, **public** access, connect it to the project. This sets `BLOB_READ_WRITE_TOKEN`. Scanned sites are stored there; without it, scans fail on Vercel because the file system is read-only.
3. **Add a demo host.** Live demos need a second address on the same project, for example `yourname-demo.vercel.app` (Settings → Domains → Add). Then:
   - set `DEMO_HOST` to that hostname;
   - replace `your-demo-host.vercel.app` in `vercel.json` (4 places) with the same hostname.
   If you skip this, everything except live demos works.
4. **Set environment variables** (Settings → Environment Variables, Production):

   | Variable | Value |
   | --- | --- |
   | `GEMINI_API_KEY` | your key |
   | `DEMO_PASSWORD` | a shared password (strongly recommended on a public URL) |
   | `CHAT_SECRET` | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `TRUST_PROXY` | `1` |
   | `DEMO_HOST` | the demo hostname from step 3 |
   | `PUBLIC_URL` | only if you use a custom domain |
   | `DAILY_BUDGET_INR` | daily Gemini spend cap in ₹ (`0` = none) |

5. **Deploy:** `vercel deploy --prod`. Environment changes only apply to new deployments, so redeploy after changing them.
6. **Check:** the home page asks for the password, a scan finishes, the WordPress plugin downloads, and a live demo opens.

Notes:

- `.vercelignore` decides what is uploaded. It never uploads `.env` files. It can bundle sample sites from `data/sites/` (listed by name); a fresh clone has none.
- The WordPress plugin contains the server URL (`PUBLIC_URL` or the Vercel production URL). Choose your final domain before giving plugins to customers: a plugin keeps calling the URL it was built with.
- Vercel Hobby is for non-commercial use and limits function run time; large scans may need Pro.
- Other hosts work too: run `npm start` behind a reverse proxy, set `PUBLIC_URL`, and either set `DEMO_HOST` or point a wildcard DNS record at the preview port and set `PREVIEW_URL_TEMPLATE=https://{id}.preview.yourdomain.com`.

## Connect Supabase (optional)

Supabase (Postgres) turns on **usage tracking**: visits, scans, demo opens and chat messages, shown on the admin page at `/usage` (`ADMIN_KEY`). Nothing else needs it today.

1. Create a Supabase project. Easiest: Vercel → the project → Storage → Supabase, which adds `POSTGRES_URL` and the `SUPABASE_*` variables for you.
2. Or set them by hand: `POSTGRES_URL` (connection string), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
3. Redeploy. Tables (`usage_events`, `handoffs`, and the payment tables) are created automatically on first use.

## Access control

One shared password, `DEMO_PASSWORD`, protects the app:

- The page asks for it as soon as it opens; nothing shows behind the dialog. The browser remembers it.
- The server checks it (header `x-sb-key`) on scans, site data, deletes and starting a live demo. The right password is never rate limited; wrong guesses are limited to 10 a minute per IP.
- Starting a demo returns a signed pass valid for 30 days for that one site. Chats in a demo with a valid pass have no rate limit.
- Leave it empty to make the app open (local development).

Public on purpose, because customer sites and AI tools call them: the widget, `/api/chat`, `/api/sites/<id>/public`, `/mcp/<id>` and the download files.

## The deliverables

**WordPress plugin** (`/sites/<id>/wordpress.zip`, built by `lib/package.js`). The customer uploads it in Plugins → Add New → Upload Plugin and activates it. It prints `<script src="<server>/widget.js" data-site="<id>" defer>` in the footer of every page, and adds Settings → Site Bridge Agent (on/off, brand colour). It also contains `knowledge.md`. Any other site uses the same script tag directly.

**Knowledge base** (`/sites/<id>/knowledge.md` and `.json`). Site profile plus the full text of every crawled page with its source URL.

**MCP server** (`POST /mcp/<id>`, JSON-RPC 2.0 over Streamable HTTP, stateless). One tool, `site_knowledge`:

- no arguments → the site profile (summary, facts, contact, pages, offerings, FAQs, tasks with steps, forms);
- `query` → the most relevant passages with source URLs;
- `page` (URL or path) → that page's full text, headings and forms.

```bash
claude mcp add --transport http <site-id> https://<your-server>/mcp/<site-id>
```

The results screen shows ready-made configs for Claude Code, Cursor, VS Code and Claude Desktop.

## Routes

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /`, `/sites/:id` | Page (password dialog) | Landing page and results screen |
| `POST /api/access/check` | Password | Checks the password |
| `POST /api/build/stream` | Password | Runs a scan; progress streams back as server-sent events |
| `POST /api/build`, `GET /api/jobs/:id/events` | Password | Older job-based scan (unused by the UI) |
| `GET /api/sites`, `GET /api/sites/:id`, `DELETE /api/sites/:id` | Password | Site list, results data, delete |
| `POST /api/demo/start/:id` | Password | Signed 30-day demo pass for one site |
| `GET /preview/:id`, demo host `/__sb/preview/:id` | Demo pass | Live demo page |
| `POST /api/chat` | Public (demo host needs a pass) | One agent turn |
| `GET /api/sites/:id/public`, `GET /widget.js` | Public, CORS | What the embedded agent loads |
| `POST /mcp/:id` | Public, CORS | MCP server |
| `GET /sites/:id/wordpress.zip`, `knowledge.md`, `knowledge.json`, `llms.txt`, `agent.json` | Public | Downloads |
| `GET /api/status` | Public | AI ready, password required, spend today |
| `POST /api/track` | Public | Anonymous usage events (no-op without a database) |
| `POST /api/sites/:id/agenticorg` | Rate limited | Hand-off to Pine Labs AgenticOrg |
| `GET /usage`, `/api/admin/*` | `x-admin-key` = `ADMIN_KEY` | Admin dashboard |
| `POST /api/auth/email`, `/api/me/credits`, `/api/pay/claim` | Dormant | Old account and payment flow |

## Code map

| File | What it does |
| --- | --- |
| `server.js` | All HTTP routes, the password gate, rate limits, downloads |
| `lib/config.js` | Reads environment variables into one `config` object |
| `lib/crawler.js` | Crawler: robots.txt, sitemap, links; optional headless rendering |
| `lib/net.js` | Safe fetching; refuses private and internal addresses |
| `lib/builder.js` | Scan pipeline: crawl → Gemini profile → index → save |
| `lib/gemini.js` | Gemini API client |
| `lib/budget.js` | Daily spend cap (`DAILY_BUDGET_INR`) |
| `lib/search.js` | BM25 search index |
| `lib/knowledge.js` | Shared read helpers: search, get page, overview, `llms.txt` |
| `lib/store.js` | Saves and loads sites: `data/sites/` locally, Vercel Blob on Vercel |
| `lib/mcp.js` | MCP server with the `site_knowledge` tool |
| `lib/package.js` | WordPress plugin zip and knowledge-base files |
| `lib/agent.js` | The chat agent loop |
| `lib/guardrails.js` | Chat safety, signed history, demo passes, rate limiter |
| `lib/proxy.js` | Live demo reverse proxy |
| `lib/agenticorg.js` | Pine Labs AgenticOrg hand-off |
| `lib/usage.js` | Usage tracking in Postgres (on when `POSTGRES_URL` is set) |
| `lib/payments.js`, `lib/authmail.js` | Dormant: UPI credits and email sign-in |
| `public/index.html`, `app.js`, `app.css`, `landing.*`, `motion.js`, `hero3d.js` | Landing page, scan form and results screen |
| `public/access.js` | Password dialog and page lock |
| `public/widget.js`, `agent-client.js` | The embeddable agent |
| `public/bridge.js` | Runs inside the proxied page: click, fill, scroll, highlight, cursor |
| `public/preview.html`, `preview.js`, `preview.css` | Live demo page |
| `public/usage.html` | Admin dashboard |
| `public/auth.js`, `pay.js` | Dormant: sign-in and payment dialogs (not loaded) |
| `vercel.json` | Rewrites for the demo host, region |

## Configuration reference

Every setting is listed with comments in [`.env.example`](.env.example). The ones that matter most:

| Variable | Needed | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | AI for scans and chat |
| `DEMO_PASSWORD` | On public deployments | Shared password; empty = open |
| `BLOB_READ_WRITE_TOKEN` | On Vercel | Where scanned sites are stored |
| `CHAT_SECRET` | On Vercel | Signs chat history and demo passes; changing it ends open demos |
| `DEMO_HOST` | For live demos on Vercel | Second address; must match `vercel.json` |
| `TRUST_PROXY` | On Vercel | `1`, so limits see real IPs |
| `PUBLIC_URL` | With a custom domain | Server URL, also written into WordPress plugins |
| `DAILY_BUDGET_INR` | No | Daily ₹ cap on Gemini spend |
| `MAX_PAGES`, `CRAWL_SECONDS`, `DIGEST_CHARS`, `RENDER_JS` | No | Scan size and depth |
| `POSTGRES_URL`, `SUPABASE_*` | No | Usage tracking |
| `ADMIN_KEY` | For `/usage` | Admin dashboard |
| `CONTACT_EMAIL` | No | Talk to Us address |
| `AGENTICORG_API_KEY`, `AGENTICORG_BASE_URL` | No | AgenticOrg hand-off |

## Guardrails and security

The chat agent is locked to the website it was built for. Everything below is on by default and lives in `lib/guardrails.js`.

- **Scope.** The agent only helps with the site. Off-topic questions get a short, friendly decline and an offer to help with the site instead.
- **No leaks.** Requests for the system prompt, instructions, API keys, model or code get a fixed polite reply without calling the model. Replies are scanned on the way out: anything that looks like an API key is redacted.
- **Prompt injection.** Page text, search results, snapshots and pasted text are treated as data, never as instructions. Jailbreak phrasings are answered politely and the persona never changes.
- **Signed history.** Every turn the server produced is HMAC-signed (`CHAT_SECRET`). Forged assistant turns or tool results are dropped.
- **Input hygiene.** Messages are capped (`CHAT_MAX_MESSAGE_CHARS`), hidden and bidirectional control characters are stripped, and only tool results the model asked for are accepted.
- **Safe actions.** UI tools only open pages on the site's own domain. The agent never types into password, one-time-code, card, bank or ID fields, never submits payments, and asks before any final submit. Demo pages block POST forms.
- **Content safety.** Gemini's safety filters are on; a blocked reply becomes a polite redirect.
- **Rate limits.** Per visitor IP and per site for the public widget. Counters live in memory, per server instance.

Secrets live only in environment variables. `.env*` files are git-ignored and never uploaded to Vercel.

## Accounts and payments (dormant code)

An earlier version had email sign-in (Supabase Auth, codes sent through Gmail SMTP or Resend) and paid live demos (UPI transfer, then the visitor enters the transaction ID for credits). It was replaced by `DEMO_PASSWORD`. The code is still in the repo but not wired up:

- front end: `public/auth.js`, `public/pay.js` (not loaded by `index.html`);
- server: `lib/authmail.js`, `lib/payments.js`, routes `/api/auth/email`, `/api/me/credits`, `/api/pay/claim`, admin payment routes;
- the first commit of this repo has the complete account-based flow, including `/api/demo/start` charging a credit per demo.

To bring it back: connect Supabase (above), set the SMTP or Resend and UPI variables, load `auth.js` and `pay.js` in `index.html` again, and restore the account-based `/api/demo/start` from the first commit. Remove these files instead if you will never need them.

## Known limits

- Only pages on the same site are crawled. robots.txt is respected and private addresses are refused.
- Some sites block automated traffic or frames in ways the proxy can't undo (bot walls, strict CORS). The MCP server, downloads and chat still work, because they use the crawled data.
- The password gate on the landing page is enforced in the browser; data and actions are enforced on the server. Use your host's password protection if the page itself must be private.
- There are no automated tests.
- Use it on sites you own or have permission to demo.
