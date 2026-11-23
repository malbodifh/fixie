# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staged audience (confirmed by the user, 2026-11-21):

1. **First: builders who ship with AI.** Indie hackers and small teams building with v0, Lovable, Bolt or Cursor on Next.js + Supabase + Vercel. They publish fast but cannot debug production, and their apps often ship with security gaps, weak SEO and slow pages.
2. **Second: agencies and freelancers.** They maintain many client sites under monthly retainers, and use the security, conversion and performance results as client deliverables.

Hackathon judges are the immediate audience of the demo: they break the demo store by QR and watch Fixie repair it live.

## Product Purpose

Fixie keeps a production web app healthy without a human on call:

- When the app throws in production, Fixie reproduces the error with a failing test in a test environment (CI) and writes the fix. A second reviewer pass then tries to break the fix again, looping up to 3 rounds, and only then is it merged to main and the deploy verified.
- It also audits the live app for security (non-destructive pentest), conversion and Lighthouse (performance, accessibility, best practices and SEO). It **repairs every code-fixable finding automatically** with the same loop: tests that reproduce the finding, the fix, a reviewer trying to break it, merge, and a re-scan of production. Findings that need the owner (hosting, DNS, rotating secrets) are explained, not touched.

Success is that the user learns about a production error only after it has already been fixed and verified.

## Positioning

The fix is proven before it ships. Fixie reproduces the failure, fixes it, and an adversarial reviewer tries to re-break it before anything reaches main. The user's database is never written to: Fixie can only add structure, always behind a backup and a rolled-back dry run.

## Operating Context

- GitHub sign-in. A project links a GitHub repo, a production URL and, optionally, a Postgres database.
- The monitored app installs a small snippet and reports errors with a per-project key.
- Incidents live as GitHub issues and PRs; CI is the test environment.
- The project dashboard has four categories: Errores, Pentesting, Conversión and Lighthouse. SEO lives inside Lighthouse (user decision, 2026-11-21). Settings sit separately.
- Fixie never only reports: anything fixable in code that needs no decision is repaired automatically, every day, at any hour (user decision, 2026-11-21). The daily review runs at 07:00 UTC (1:00 a.m. Mexico City) and a server-side motor drives every open repair to the end with nobody watching the dashboard. One code repair at a time per project, by priority: errors, deep pentest, surface pentest, Lighthouse. Retries are daily; after 3 failed attempts on the same findings Fixie pauses that set for a week.
- Errores: production errors from the snippet plus a nightly hunt that costs as few tokens as possible: crawl production pages and read the main branch CI (no AI), then AI only over the diff since the previous review.
- Pentesting has three layers: Superficie (TLS, headers, cookies, CORS, 18 sensitive paths; modelled on Vertex-Scan's modules, own code since that repo has no license), Pentest profundo (Shannon by Keygraph, AGPL, run through its official GitHub Action in the client's own CI against a copy of the app started inside the runner, never production; weekly; the model key is stored only as an encrypted GitHub secret). Zero setup for the user: the workflow builds the test environment itself (detects Postgres, Supabase, Prisma or Drizzle; throwaway database with the production schema copied without any rows; generated secrets and local URLs; repo .env files removed inside the runner; a test account when the app uses Supabase Auth). The user only pastes the model key: DeepSeek V4.1 Flash by default, charged to their own provider account, not to Fixie credits and the dependency watch.
- Conversión is the one category that never applies changes on its own: Fixie proposes (technical fixes plus copy rewrites from a compact prompt based on coreyhaines31/marketingskills, MIT) and the user ticks what to apply.
- Lighthouse runs on mobile and desktop; whenever any category is below 90 Fixie repairs what is code-fixable to raise it.
- Dependency watch 24/7 (inside Pentesting) is **paid-only: Pro, Max and Enterprise** (user decision, 2026-11-22). Those projects show a "Cobertura de vulnerabilidades conocidas" badge next to the project name; Free sees a card explaining it is included in paid plans, and the watch neither runs nor repairs for Free. Every 15 minutes the exact versions in package-lock.json are checked against OSV/GitHub Advisories and the CISA known-exploited catalog; when a patched version exists, Fixie updates package.json and the lockfile immediately through the same loop. Major-version jumps and packages pinned by others are left for a human.

## Capabilities and Constraints

- The product name is **Fixie**. "Autosana" was the working name and must not appear in user-facing copy. Internal identifiers (env vars, routes, labels) may keep it until a planned migration.
- The AI never deletes or modifies client data. It may only add structure, after a backup and a rolled-back dry run. It does a weekly backup before the weekly review.
- Active pentest probes run only on domains whose ownership has been verified.
- Lighthouse needs a public URL and a PageSpeed Insights key.
- Plans: **Free, Pro, Max and Enterprise** (user decision, 2026-11-22). Each plan is an AI-credit allowance per 30-day cycle anchored on the payment day (1 credit = US$0.01 of DeepSeek cost): Free 50; Pro, Max and Enterprise 1000 each (US$10, user decision 2026-11-22; editable in src/lib/plans.ts). The cycle splits into 4 equal weekly allowances (US$2.50 per week on paid plans; the last week absorbs the 2 extra days). What else separates Pro, Max and Enterprise is undecided.
- Limits: the moment the weekly allowance runs out, the agent stops mid-task and the incident or repair is paused, not failed; it resumes on its own when credits renew (or at once after an upgrade). A critical error is still repaired in weeks 1 and 2 after payment (paid plans only), and that extra spend is deducted from the next week. No plan can ever exceed US$10 of DeepSeek per cycle. Scans, the dependency watch and backups never consume credits. The Uso page in the navbar shows the week, the cycle and where credits went; the navbar shows the plan.
- **Plan prices are undecided and must not be invented.**
- Navigation is a collapsible left sidebar (Proyectos, Asistente, Uso with the weekly usage ring, Conectar tu IA, account and plan at the bottom); on mobile it is a drawer behind a menu button (user decision, 2026-11-22). The landing page keeps a simple top header.
- Help assistant two ways (user decision, 2026-11-22): the in-app Asistente (DeepSeek, spends plan credits; composer modeled on the user's reference with + quick questions, send and voice dictation, Fixie peeking animated over its top-right corner) and an MCP server at /api/mcp with a personal token from Conectar tu IA, where the user's own AI supplies the model so chatting spends no Fixie credits; only actions that start the agent do. Both share the same tools (src/lib/assistant.ts).
- The project dashboard has a fifth category, Revisión completa: one button runs the 4 tests at once and Fixie then repairs and merges what it found through the usual loop; Conversión still only proposes.

## Brand Commitments

- The mascot is **Fixie**, a small robot that is also the product's name. It is being redesigned as clean vector art in the brand colors (white, black, blue) with good contrast in both themes. It appears only at key moments: the landing page, empty states, and while it is fixing something.
- Blue is the single brand accent.
- The interface follows the system light/dark preference.
- **No emojis anywhere in the UI.**
- References the user made binding: Apple, Notion and shadcn/ui.
- Copy is in Spanish.

## Evidence on Hand

- A working demo store, `demo-tienda/` (repo malbodifh/autosana-demo-tienda), with 3 planted bugs.
- A live end-to-end loop.
- Real scan results on the demo store.
- No customers, testimonials, usage numbers or prices exist yet. Do not fabricate them.

## Product Principles

1. **Prove, don't promise.** Every fix is shown reproduced, fixed and re-attacked before it ships.
2. **The user's data is sacred.** Safety guarantees are visible, not buried.
3. **Calm by default.** A healthy app looks quiet; attention goes only where something needs action.
4. **Explain the fix.** Every finding says why it matters and exactly how to fix it.
