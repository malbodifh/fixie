---
version: 1
slug: "src-app"
primary_target: "src/app"
related_targets: []
---

## Scope
Whole Fixie web app (src/app): landing (Persuade), project list, new project, project dashboard with Errores / Pentesting / SEO / Lighthouse tabs and Ajustes (Operate), live incident view.

## Audience and task
Builders shipping with AI (v0, Lovable, Bolt, Cursor) first, agencies second. Dashboard task: see at a glance whether the app is healthy in the 4 categories, act on what is broken, watch Fixie repair incidents live. Landing: understand the reproduce -> fix -> re-attack -> ship loop and sign in with GitHub.

## Direction contract
THESIS: Fixie is a calm, trustworthy tool that proves fixes before they ship. Pinned by the user: Apple / Notion / shadcn canon, played straight at full fidelity. Refuses the neon-on-black "AI devtool" look, terminal costume, gradients and emoji.
OWN-WORLD: Geist sans + Geist Mono for code/data only. Neutral zinc surfaces, 1px hairline borders, 10-12px radii, soft offset shadows in light only, one blue accent (#0a6cff light / #3b8bff dark) for primary actions, selection and state. Lucide stroke icons, 1.75 stroke. Follows system light/dark. Vector Fixie robot in white/black/blue.
STORY: visitor sees a real incident being fixed in the hero demo, believes the fix is proven and the data untouched, signs in with GitHub; operator sees four category states, opens one, follows the "how to fix" for each finding.
FIRST VIEWPORT: landing: left, a 56-64px balanced headline, one sentence, primary "Entrar con GitHub" + secondary "Ver una demo"; right, a product window showing a live incident stepper with Fixie. Dashboard: project title row, segmented tabs with status badges, active category content immediately below.
FORM: canon (user-pinned: Apple / Notion / shadcn), position 1, seed key: none (user-pinned direction beats the roll).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
