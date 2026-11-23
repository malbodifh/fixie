# Fixie

Fixie keeps a production web app healthy with nobody on call.

When the app throws in production, Fixie:

1. reproduces the error with a failing test in CI;
2. writes the fix;
3. lets an adversarial reviewer agent try to break the fix again (up to 3 rounds);
4. merges to `main` and checks that the deploy is live.

Fixie also audits the live app (Errores, Pentesting, Conversión, Lighthouse) and repairs what code can fix through the same loop. The client's database is never written to: Fixie may only add structure, after a backup and a dry run that is rolled back.

Product truth lives in [PRODUCT.md](PRODUCT.md) and the visual system in [DESIGN.md](DESIGN.md).

## Stack

- Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4
- Supabase for Fixie's own database and backups storage (server-only, secret key)
- GitHub OAuth; incidents live as GitHub issues and pull requests
- DeepSeek V4.1 Flash through the AI SDK for the agents
- Vercel for hosting, with Vercel Schedules for the crons

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the values, see below
npm run dev
```

Open http://localhost:3000. In development you can sign in without an OAuth App: set `DEV_GITHUB_TOKEN` (for example from `gh auth token`).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `AUTOSANA_SECRET` | yes | Master key: encrypts tokens and DB connections, signs the session (32 random bytes). |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | yes | Fixie's own database. Only the server uses them. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | production | GitHub OAuth App. Callback: `<base url>/api/auth/callback`. Scopes: `repo workflow read:user`. |
| `AUTOSANA_BASE_URL` | production | Public URL of Fixie. On Vercel it falls back to `VERCEL_PROJECT_PRODUCTION_URL`. |
| `CRON_SECRET` | production | Bearer secret for the cron and motor routes. Without it they refuse every call. |
| `DEEPSEEK_API_KEY` | for AI work | Agents, daily diff review, copy suggestions and the in-app assistant. |
| `AGENT_MODEL`, `AGENT_FAST_MODEL` | no | Override the model aliases (default `deepseek-flash`). |
| `PSI_API_KEY` | for Lighthouse | PageSpeed Insights API key. |
| `DEV_GITHUB_TOKEN` | development only | Sign in without an OAuth App. Ignored in production. |

The internal `AUTOSANA_*` names are kept from the working name until a planned rename.

## Database

The schema is versioned in [supabase/migrations](supabase/migrations). Apply the files in order to a new Supabase project, for example with `supabase db push`. Row level security is on for every table with no policies, so only the server (secret key) can read or write.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (`src/**/*.test.ts`, Node's test runner through tsx) |

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs typecheck, lint, tests and the build on every push and pull request.

## Layout

```
src/app            pages, server actions and API routes
src/app/api        auth, ingest (/api/incidents), crons, motor, chat, MCP
src/lib/agent      the agents: diagnose, fix, review, repair, dependency updates
src/lib/scans      Errores, Pentesting (surface, Shannon deep pentest, dependencies), Conversión, Lighthouse
src/lib/clientdb   read-only access to the client's database and the SQL guard
supabase           Fixie's own database migrations
demo-tienda        demo store with planted bugs (its own repo, ignored here)
```

## Safety rules

- `src/lib/clientdb/guard.ts` is the first barrier for the client's database. Postgres (read-only transactions, role permissions) is the second. Never weaken it. Its tests are in `guard.test.ts`.
- Shannon, the deep pentester, never attacks production. It runs in the client's own GitHub Actions against a throwaway copy of the app, with the production schema and no rows.
- The model key for Shannon belongs to the client and is stored only as an encrypted GitHub secret.
