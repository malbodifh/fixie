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
- Pentesting has three layers: Superficie (TLS, headers, cookies, CORS, 18 sensitive paths; modelled on Vertex-Scan's modules, own code since that repo has no license), Pentest profundo (Shannon by Keygraph, AGPL, run through its official GitHub Action in the client's own CI against a copy of the app started inside the runner, never production; weekly; the model key is stored only as an encrypted GitHub secret) and the dependency watch.
- Conversión is the one category that never applies changes on its own: Fixie proposes (technical fixes plus copy rewrites from a compact prompt based on coreyhaines31/marketingskills, MIT) and the user ticks what to apply.
- Lighthouse runs on mobile and desktop; whenever any category is below 90 Fixie repairs what is code-fixable to raise it.
- Dependency watch 24/7 (inside Pentesting): every 15 minutes the exact versions in package-lock.json are checked against OSV/GitHub Advisories and the CISA known-exploited catalog; when a patched version exists, Fixie updates package.json and the lockfile immediately through the same loop. Major-version jumps and packages pinned by others are left for a human.

## Capabilities and Constraints

- The product name is **Fixie**. "Autosana" was the working name and must not appear in user-facing copy. Internal identifiers (env vars, routes, labels) may keep it until a planned migration.
- The AI never deletes or modifies client data. It may only add structure, after a backup and a rolled-back dry run. It does a weekly backup before the weekly review.
- Active pentest probes run only on domains whose ownership has been verified.
- Lighthouse needs a public URL and a PageSpeed Insights key.
- Monetization: staged plans (a free tier, a per-project Pro plan, and an Agency plan by volume with branded reports). **Prices are undecided and must not be invented.**

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
