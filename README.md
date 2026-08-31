# Scavenger Hunt App

Invite-only web app for an annual friend-group Halloween scavenger hunt.
Teams sign up (Google sign-in via Cognito + a shared event code), upload a
photo/video to validate each challenge, and scores are calculated
automatically.

## Structure
- `infra/` — AWS CDK app (single stack)
- `backend/` — Lambda handlers
- `frontend/` — React + Vite + TS + Tailwind + ShadCN
- `shared/` — TypeScript types shared between backend and frontend

## Status
Scaffolding only — infrastructure decisions are being made incrementally.
See commit history / conversation notes for what's been decided vs. still open.
