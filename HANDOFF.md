# Handoff: Halloween Scavenger Hunt App

This project was scoped and started with Andrew in a Claude.ai chat, then
handed off here to Cowork for the rest of the build. Read this whole file
before doing anything else — it replaces a re-explanation of everything
that's already been decided.

## What this is

An invite-only web app for an annual friend-group Halloween scavenger
hunt (run by Andrew's brother-in-law, who's on board with the concept).
Teams sign in, upload a photo/video to validate each challenge, check
off tasks, and get scores calculated automatically. Small-to-medium
scale — under 10 teams, or up to ~30.

## Why AWS, specifically

This is explicitly a **portfolio project** for Andrew's career pivot
toward cloud-architecture roles. He's willing to spend a modest amount
for the resume value — this is not a "minimize cost above all else"
build, though it shouldn't be wasteful either. Expected steady-state
cost once fully built is roughly $10–20/month while deployed; the whole
stack is meant to be torn down (`cdk destroy`) between events.

## How Andrew wants to work — read this twice

This is the most important section. His words: **"I'd like to be
involved in the decision making process though so don't do too much
without my input."**

In practice, in the scoping conversation this meant:
- Propose a plan or structure and pause for confirmation before
  generating it, rather than just doing it.
- Build one construct/decision at a time (e.g. Cognito, then DynamoDB,
  then Secrets Manager...), not the whole stack in one shot.
- Name trade-offs explicitly (cost, complexity, alternatives) instead
  of silently picking one and moving on.
- For concrete forks with a small number of options, ask directly
  rather than assuming.

Carry this forward. Before writing a meaningful chunk of infrastructure
or making an architectural call, check in and explain the trade-off —
don't build first and report after.

## Current status

Scaffolded and verified building (`npm install`, `tsc`, `cdk synth`,
and `vite build` all pass clean as of handoff):

- Monorepo: `infra/` (CDK, TypeScript), `backend/` (Lambda handlers —
  empty placeholder), `frontend/` (Vite + React + TS + Tailwind
  installed and running — no actual UI/screens built yet), `shared/`
  (types package — empty placeholder).
- `infra/lib/scavenger-hunt-stack.ts` is an **empty stack** — just a
  comment listing the planned build order. No AWS resources defined
  yet.
- No GitHub repo yet — Andrew said he'd set one up himself.
- **Correction to an earlier version of this handoff**: there is no
  `.github/` directory at all. The deploy workflow does not exist and
  still needs writing, along with a GitHub OIDC IAM role.
- **Git has no commits.** `main` exists but is empty; everything is
  untracked. There is also a stale `.git/index.lock` that blocks commits —
  `rm .git/index.lock` clears it. (Cowork's shell on the Mac cannot
  delete files, so Andrew has to run that himself.)

## Architecture decisions already made

Full write-up in `ARCHITECTURE.md` in this same folder. Summary:

- **Auth**: Amazon Cognito User Pool, Google as the social identity
  provider. Plus a single shared **event code** (not per-team invite
  links) that gates entry after sign-in — one code for the whole
  event, distributed by the organizer.
- **Data**: DynamoDB — teams, users, challenges, submissions, scores.
  Exact table/field design is NOT yet decided — that's an open decision
  for the next session.
- **Media**: uploads go directly to **Google Drive**, not S3 — an
  admin-owned Drive account, folders organized per team/challenge, via
  resumable upload sessions kicked off by Lambda. Client-side image
  compression before upload; RAW/DNG files are detected (not processed
  — browsers can't decode RAW) and the user is prompted to switch their
  camera mode instead.
- **Compute**: API Gateway (HTTP API) → Lambda, TypeScript.
- **Frontend hosting**: S3 holds only the built web app, never user
  content. One CloudFront distribution routes both the S3 static
  assets and `/api/*` to API Gateway, under one domain, to avoid CORS.
  Route 53 + ACM for the custom domain.
- **Security/observability** — all decided to be part of the initial
  build, not deferred: WAF on CloudFront/API Gateway, Secrets Manager
  for the event code + Google OAuth client secret + Drive admin
  credentials, IAM least-privilege roles, CloudWatch dashboard +
  structured logging + a billing alarm, X-Ray tracing.
- **CI/CD**: GitHub Actions running `cdk deploy` on merge to `main`
  (workflow file exists, AWS credentials step not yet wired up).

## Planned build order

From the comment in `scavenger-hunt-stack.ts`:

1. **Cognito User Pool (Google as IdP) — next up**
2. DynamoDB table(s)
3. Secrets Manager
4. Lambda functions + IAM roles
5. API Gateway
6. S3 bucket (frontend build only)
7. CloudFront (S3 + API Gateway origins, single domain)
8. Route 53 + ACM
9. WAF
10. CloudWatch dashboard + billing alarm, X-Ray tracing

## Who this is for

Andrew — cybersecurity engineer (TS/SCI cleared, W2 contractor
supporting DHS), pivoting toward cloud-architecture roles, comfortable
with TypeScript, Python, and PowerShell. This app is partly a portfolio
piece for that pivot, partly a real thing his brother-in-law's friend
group will use this Halloween.
