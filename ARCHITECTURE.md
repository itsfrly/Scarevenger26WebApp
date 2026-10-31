# Halloween Scavenger Hunt App — Architecture

## Overview
Invite-only web app for an annual friend-group Halloween scavenger hunt. Teams sign up, upload a photo/video to validate each challenge, check off tasks, and download their own uploads. Scores are calculated automatically. Built on AWS, intentionally, as a cloud-architecture portfolio piece.

## Access model
- Sign in with **Google** (via Amazon Cognito).
- After sign-in, enter a **single shared event code** (one code for the whole event, distributed by the organizer however he already communicates with the group).
- Once past the code, a user creates a new team or joins an existing one.
- No per-team invite links, no admin-approved allowlist — the event code is the only gate.

## Frontend
- React + TypeScript + Tailwind + ShadCN, built as a static SPA.
- Hosted as static files in **S3** — S3 holds only the web app's build output, never user-uploaded content.
- **CloudFront** sits in front of S3 for HTTPS + CDN, with **API Gateway** as a second origin on the same distribution (routed by path, e.g. `/api/*`) — one domain for both frontend and API, which avoids CORS entirely.
- **Route 53** for DNS, **ACM** for the TLS certificate CloudFront needs to serve the custom domain over HTTPS.

## API
- **API Gateway (HTTP API)** → **Lambda** (TypeScript).
- API Gateway usage plan / throttling, since the event code is the only thing standing between this and the open internet.

## Auth
- **Amazon Cognito User Pool**, Google configured as a social identity provider.
- Free indefinitely at this scale (10,000 MAU free tier, doesn't expire after 12 months).
- Event code check happens after Cognito auth, inside the app logic — not a Cognito feature itself.

## Data

Single DynamoDB table, key-overloaded, on-demand billing, one GSI.

| Entity | pk | sk | gsi1pk | gsi1sk |
|---|---|---|---|---|
| User | `USER#<sub>` | `PROFILE` | | |
| Team | `TEAM#<id>` | `METADATA` | `EVENT#<year>` | `TEAM#<id>` |
| Member | `TEAM#<id>` | `MEMBER#<sub>` | | |
| Submission | `TEAM#<id>` | `SUB#<challengeId>` | | |
| Challenge | `EVENT#<year>` | `CHALLENGE#<id>` | | |

Access patterns:

1. Get user by Cognito sub — GetItem `USER#<sub>` / `PROFILE`
2. Team dashboard — Query `TEAM#<id>`, returns metadata, members and
   submissions in one round trip
3. Team's submissions — Query `TEAM#<id>`, sk begins_with `SUB#`
4. List challenges — Query `EVENT#<year>`, sk begins_with `CHALLENGE#`
5. List teams / scoreboard — Query gsi1 `EVENT#<year>`, gsi1sk begins_with `TEAM#`
6. Full export — Scan, ~2,000 items

Pattern 2 is the reason for one table rather than four: team, members and
submissions share a partition. At this scale (~30 teams, ~100 users, ~40
challenges) multi-table would perform and cost identically — the single-table
choice buys that one query and nothing else.

Team `score` is denormalised so the scoreboard is a single query rather than a
fan-out over submissions.

The event code is not a DB record — it is a Secrets Manager value compared at
request time. The result is stored as `eventVerified` on the user item.

Admin is a Cognito group (`admins`), read from the `cognito:groups` JWT claim,
so it is not a stored field and costs no read. Membership is assigned by hand
in the console, and is lost whenever the user pool is destroyed — re-add
admins after each rebuild.

## Challenges and scoring

Two challenge types share one mechanism:

- **standard** — every team can earn `points` by submitting.
- **ranked** — `awards: [{place, points}]`, judges assign `placements:
  [{place, teamIds}]`. A single award entry is winner-takes-all; several give
  podium scoring. More than one `teamId` at a place is a tie, and tied teams
  each take that place's full points — the judge skips the next place by
  simply not assigning it.

`proofType` governs what a submission must carry: `none` (honour system),
`photo` (exactly one), `photos` (1..`maxFiles`), `video` (exactly one).
Submissions hold a `files[]` array, so multi-photo challenges are one
submission rather than several.

A challenge may set `metricLabel` ("Skeeball score") and `metricDirection`,
which prompts teams for a number and lets judges sort the review queue instead
of opening thirty photos on a phone.

**Scoring is optimistic.** Standard challenges award points the moment a team
submits, so the scoreboard is live all evening; a judge marking a submission
`rejected` takes them back. Ranked challenges award nothing until a judge
assigns placements.

**Score is recomputed, never incremented.** `teamScore()` in `shared/` is the
only place scoring logic lives, and every scoring event recomputes the affected
teams from scratch (two queries, ~45 items). Incremental deltas were rejected:
rejections and placement changes move several teams at once, and a missed
decrement is silent and permanent, whereas a lost recompute corrects itself on
the next event. `POST /admin/recalculate` rebuilds every team as a safety net.

## Roles

| Group | Can |
|---|---|
| _(none)_ | Play, once past the event code |
| `judges` | Review submissions, assign placements |
| `admins` | Everything judges can, plus edit challenges, recalculate, export |

Both are Cognito groups assigned by hand in the console, read from the
`cognito:groups` JWT claim.

**Admins are exempt from the event-code gate in both the API and the
frontend.** They distribute the code and run the event. This must stay
consistent in both places: exempting them only in the client lets an admin
reach the app and then fail on their first submission.

## Event data export

Required for two different reasons, which need two different mechanisms:

- **Paper fallback during the event.** An on-demand admin export is only
  useful for partial failures (a bad frontend deploy, Drive quota, a dead
  phone). If the API is what is broken, an API-based export is broken too. So
  the real fallback is a scoreboard and challenge checklist **printed before
  the event**, backed by a scheduled snapshot to S3 during the event window.
- **Before teardown.** `cdk destroy` deletes the table. Export first, or the
  event record is gone.

Both read the same Scan, so they share one Lambda.

## Media / uploads

**Reversed from the original Google Drive plan.** Drive was chosen to avoid S3
storage cost, but the arithmetic did not survive scrutiny: ~1,800 compressed
files is 3-4GB, which is roughly $0.09/month, and reads served through
CloudFront fall inside its free allowance (S3-to-CloudFront origin transfer is
waived). The saving was cents; the cost was a fragile integration.

It also would not have worked as designed. Google **service accounts have no
usable Drive storage** — uploads to My Drive fail with `storageQuotaExceeded`
— and both workarounds (Shared Drives, domain-wide delegation) require Google
Workspace, which a personal account does not have. The consumer-account path
is an OAuth refresh token, and refresh tokens issued while the consent screen
is in Testing expire after 7 days, which would have broken days before the
event.

Current design:

- Private S3 bucket, `BLOCK_ALL` public access, SSE-S3, TLS enforced.
- Browser uploads direct to S3 via a **presigned POST** from `POST /uploads`.
  POST rather than PUT because only POST carries a `content-length-range`
  condition, so the 50MB cap is enforced by S3 rather than trusted from the
  client. Content type is pinned in the policy and restricted to image/video.
- Object keys are built server-side as
  `media/<teamId>/<challengeId>/<uuid>.<ext>` from the caller's own team, so a
  client cannot obtain a URL that writes into another team's prefix.
- `POST /submissions` re-validates the key prefix and does a `HeadObject`, so a
  team cannot record submissions for files they never uploaded.
- Reads are served through CloudFront with OAC; the bucket is never public.
- 90-day lifecycle expiry so media does not accumulate year over year.
- Bucket is `RETAIN` on `cdk destroy` and deliberately unnamed: a fixed name
  plus RETAIN would collide on the next deploy, whereas auto-naming means next
  year gets a fresh bucket and last year's photos stay put. The photos are the
  irreplaceable part of the event; the stack is not.
- Client-side compression (~2000-2500px long edge) still applies before upload,
  and RAW/DNG is detected and rejected with a prompt to switch camera modes.
- Drive, if still wanted, becomes a **post-event bulk copy script** — run once,
  no runtime dependency, and Drive's own UI handles bulk download.

## CloudFront

One distribution serves everything under a single origin, which is what
removes CORS from the picture:

| Path | Origin | Cache |
|---|---|---|
| `/*` | Site bucket (OAC) | CachingOptimized |
| `/api/*` | HTTP API | CachingDisabled, `ALL_VIEWER_EXCEPT_HOST_HEADER` |
| `/media/*` | Media bucket (OAC) | CachingOptimized |

Notes worth keeping:

- **API routes carry the `/api` prefix in API Gateway itself**, so CloudFront
  forwards the path unchanged. The alternative -- a CloudFront Function
  stripping the prefix -- is one more moving part for no benefit, since nothing
  else consumes this API.
- The `/api/*` behaviour must use `ALL_VIEWER_EXCEPT_HOST_HEADER`. Forwarding
  the viewer `Host` header to an API Gateway origin breaks SNI; omitting the
  policy entirely drops the `Authorization` header and every request 401s.
- **SPA routing is a CloudFront Function on viewer-request, not
  `errorResponses`.** `errorResponses` are distribution-wide with no path
  scoping, so mapping 403/404 to `index.html` silently swallowed every API
  403 and 404 — the event-code gate, the admin and judge checks, "not found" —
  and returned HTML to the caller instead. The rewrite is attached only to the
  default behaviour, so API and media responses pass through untouched. The
  smoke test asserts an API 404 is still a 404 and still JSON.
- CloudFront Functions run a restricted JS runtime: no `startsWith`, no
  `includes`, no template literals.
- `PRICE_CLASS_100` (North America and Europe). The event is in one town.
- Media is served from a private bucket via OAC under UUID keys. This is
  **unlisted, not private**: anyone with a link can view it without signing in.
  Accepted for a friend group; CloudFront signed cookies are the upgrade path
  if that changes.
- Site bucket is `DESTROY` with `autoDeleteObjects` -- it holds build output,
  which is disposable. The media bucket is `RETAIN`. Different data, different
  policy.

Distribution changes take 5-15 minutes to propagate, but only when the
distribution's own config changes. Lambda, API and table changes do not touch
it, so the backend iteration loop stays fast.

## Security
- IAM least-privilege execution roles for Lambda.
- **Secrets Manager** for the event code, Google OAuth client secret, and the admin Google Drive credentials.
- **WAF** on the CloudFront distribution / API Gateway — rate limiting and managed rule groups.

## WAF

**AWS WAF cannot attach to an API Gateway HTTP API** — it supports CloudFront,
ALB, REST APIs, AppSync and Cognito only. CloudFront is therefore the sole
enforcement point.

That leaves a hole: the `execute-api` URL is public and bypasses the
distribution entirely. It is closed with an origin-verify header — CloudFront
injects a Secrets Manager value on `/api/*`, and `handle()` rejects anything
without it. The check lives in the wrapper rather than each handler so a new
route cannot forget it. The smoke test asserts a direct `execute-api` call
returns 403.

Rules:

| Rule | Action | Notes |
|---|---|---|
| `ApiRateLimit` | Block | 5,000 per IP per 5 min, scoped to `/api/*` |
| `AmazonIpReputation` | **Count** | Flip to Block before the event |

The rate limit is deliberately generous. The group may all be on one house's
wifi, so every request shares a source IP — a tight limit locks out the party
rather than an attacker. Static assets and media are excluded from the count
since they are edge-cached and harmless.

Managed rules start in COUNT so a false positive appears in CloudWatch rather
than as someone unable to submit a photo. **Before the event**, check the
`AmazonIpReputation` metric for matches against real traffic, then:

```bash
export SCAREVENGER_BLOCK_MANAGED_RULES=true
cd infra && cdk deploy
```

Rejected: `AWSManagedRulesCommonRuleSet` and `KnownBadInputs`. They add ~$2/mo
and guard mostly against injection and traffic shapes this stack does not have,
while CommonRuleSet is the usual source of false positives.

## Observability

CloudWatch dashboard `scarevenger`, plus alarms to an SNS topic. Set
`SCAREVENGER_ALARM_EMAIL` to subscribe an address — AWS sends a confirmation
link that must be clicked before anything is delivered.

Widgets: API request count / 4xx / 5xx, API p95 and p99 latency, Lambda errors
and throttles, Lambda p95 duration, DynamoDB throttles, event-code accepted vs
rejected (Powertools custom metrics), and WAF blocked vs counted.

Alarms are limited to things that mean **someone at the party is stuck**: API
5xx, API p95 latency above 3s, and Lambda errors per function. Deliberately no
alarm on 4xx — a wrong event code is a 403 and entirely expected.
`treatMissingData: NOT_BREACHING`, since an app used one night a year is
usually silent.

X-Ray tracing is active on every function, and Powertools emits structured
JSON logs with a correlation id.

## Ending the hunt

The event has a phase (`open` / `ended`) stored at `EVENT#<year> / STATE`.
Absent means open, so no migration was needed.

An admin ends it from the Admin screen. Ending:

- **closes submissions and uploads** — the presigned-URL endpoint refuses too,
  not just the submission, or media would keep landing in the bucket
- **opens the slideshow** to everyone, at `/slideshow`

Judging stays open afterwards, because scores still need finalising. The
scoreboard is unchanged — it has been live all evening, so there is no reveal
to protect.

Reversible on purpose: it is a single button at a party and will get pressed
early. `endedAt` is written once with `if_not_exists` and preserved across a
reopen, because it seeds the shuffle.

### The slideshow

- Every non-rejected file from every team, shuffled. Rejected submissions are
  usually dummy photos, so they stay out of the reel.
- **Seeded shuffle, not `Math.random`.** Every viewer gets the same order, so
  people watching together on separate phones stay on the same slide and "go
  back, I missed one" works. The seed is `endedAt`.
- Photos advance on a 6s timer; videos advance when they finish playing.
- The next image is preloaded while the current one is on screen.
- Before the hunt ends, `/api/gallery` returns 409 for players. Admins can
  preview.

**Cost note:** this is the first feature where everyone loads everyone's
media. ~1,800 files at ~1.5MB is ~2.7GB per full viewing — around 80GB for
thirty viewers, inside CloudFront's 100GB allowance, but a hundred viewers or
heavy video would push into the next tier (~$15 for that month).

## Event snapshots

An EventBridge rule runs a Lambda every 15 minutes that scans the table and
writes `snapshots/<timestamp>.json`, `snapshots/<timestamp>.csv` and a stable
`latest.csv` to a dedicated bucket.

- **Disabled by default.** Enable for the event window:
  `export SCAREVENGER_SNAPSHOTS_ENABLED=true && cdk deploy`
- **Its own bucket, not a prefix on the media bucket.** Media is served
  publicly through CloudFront under `/media/*`, so an export placed there
  would be downloadable by anyone who guessed the path.
- Versioned and `RETAIN` on destroy: the record of the event outlives the
  stack.
- Retrieval is via the console or `aws s3 cp` — deliberately not through the
  API, since the whole point is a fallback for when the API is what broke.

The export logic is shared with `GET /api/admin/export` rather than
duplicated.

## CI/CD

GitHub Actions with OIDC federation — no long-lived AWS keys anywhere, matching
the IAM Identity Center approach used for humans.

**The deploy role has almost no permissions of its own.** All it can do is
assume the CDK bootstrap roles, which perform the actual deployment. A
compromised workflow can deploy this stack; it cannot administer the account.
Its trust policy pins `sub` to `repo:<owner>/<repo>:ref:refs/heads/main` —
without that condition, any GitHub repository on earth could assume it.

Two workflows:

- **`ci.yml`** — on every PR and push. Typecheck all four workspaces, run unit
  tests, build the frontend with stub auth values. No AWS credentials at all.
- **`deploy.yml`** — on push to `main`. Assumes the role, reads live stack
  outputs to generate `frontend/.env.local`, builds, then `cdk deploy`.
  Concurrency-grouped so two pushes queue rather than colliding in
  CloudFormation.

Notes:

- The deploy job reads stack outputs *before* building, because Vite inlines
  `VITE_*` at build time. This requires the stack to already exist; the first
  deploy in a fresh account is done locally.
- `npm install`, not `npm ci`. npm's optional-dependency bug can produce a
  lockfile missing the platform binaries another OS needs (esbuild, rollup),
  and `npm ci` will not repair it.
- Only one GitHub OIDC provider may exist per account. Set
  `SCAREVENGER_GITHUB_OIDC_EXISTS=true` if the account already has one.

### Configuration model

Non-secret settings live in `infra/cdk.json` under `scarevenger:*` and are
committed. Local and CI deploys read the same values, so they cannot drift —
an earlier design put these in environment variables mirrored into GitHub
repo variables, which meant a push to `main` could silently revert a flag
someone had set locally. Flipping the custom domain on is now a one-line
reviewable commit.

Precedence: `-c` flag, then `SCAREVENGER_<UPPER_SNAKE>`, then `cdk.json`. The
env var is for one-off local experiments, not for configuring a deployment.

| Setting | Where |
|---|---|
| `scarevenger:googleClientId` | cdk.json (public by design) |
| `scarevenger:customAuthDomain` | cdk.json — `true` at cutover |
| `scarevenger:blockManagedRules` | cdk.json — `true` once WAF counts are clean |
| `scarevenger:snapshotsEnabled` | cdk.json — `true` for the event window |
| `scarevenger:alarmEmail` | cdk.json |
| ACM certificate ARN | **`SCAREVENGER_CERT_ARN` / `CERT_ARN` secret** — contains the account id |

Only two GitHub repo settings are needed: the `AWS_DEPLOY_ROLE` and `CERT_ARN`
secrets.

## Cost expectation
Previously estimated at $2–5/month for a bare-bones version. With Cognito (free at this scale) added and WAF folded in as a real recurring line item (~$5–10/month base), a more realistic range for the fully-featured build is roughly **$10–20/month** while it's actively deployed — still torn down between events.

## Domain & DNS

- Domain: **scarevenger.app**, registered at **Cloudflare Registrar**.
- `.app` is HSTS-preloaded at the TLD level — HTTPS is mandatory, browsers
  refuse plain HTTP with no click-through bypass. A valid ACM certificate is
  therefore a hard prerequisite, not a nice-to-have: nothing on the domain is
  reachable until the cert is issued.
- **DNS stays at Cloudflare.** Cloudflare Registrar requires domains
  registered there to use Cloudflare nameservers, and ICANN's 60-day
  post-registration transfer lock rules out moving the domain before the
  event. Route 53 is therefore *not* the authoritative DNS for this project.
- Considered and rejected: delegating a subdomain (e.g. `hunt.scarevenger.app`)
  to a Route 53 hosted zone via NS records. That would have put DNS, ACM
  validation and the Cognito domain record fully under CDK for $0.50/month,
  but at the cost of a two-level URL (`login.hunt.scarevenger.app`). Four
  one-time manual DNS records was judged the better trade for a URL people
  actually see. **This is a deliberate decision, not an oversight** — DNS is
  the one part of this stack intentionally outside IaC.
- Cloudflare proxying (orange cloud) is **off** for all records:
  - `login.scarevenger.app` **must** be DNS-only. Cognito's custom domain
    fronts its own CloudFront distribution and does host/SNI validation;
    a proxy in the path breaks it.
  - The apex is DNS-only by choice. Proxying would give free Cloudflare
    DDoS/WAF and make AWS WAF (~$5–10/mo, the largest single line item)
    redundant, but stacks two CDNs and removes WAF-on-CloudFront from the
    architecture. AWS-native was chosen deliberately.

### DNS records (created by hand in Cloudflare, once)

| Name | Type | Value | Notes |
|---|---|---|---|
| `_<acm>.scarevenger.app` | CNAME | `_<acm>.acm-validations.aws` | Must persist forever — it is what lets the cert auto-renew |
| `scarevenger.app` | A | `192.0.2.1` (placeholder) | Cognito refuses to create a custom domain unless the parent domain has a resolving A record. Replaced by the CloudFront alias later. |
| `login.scarevenger.app` | CNAME | CloudFront hostname returned by Cognito | Grey cloud, mandatory |
| `scarevenger.app` | CNAME → CloudFront | (via Cloudflare CNAME flattening) | Added at step 7, replaces the placeholder A |

### Certificate

One ACM certificate in **us-east-1** covering `scarevenger.app` and
`*.scarevenger.app`. ACM emits a single validation CNAME covering both, so
only one record needs pasting into Cloudflare. Because DNS is not in Route 53,
CDK cannot validate the cert automatically — the certificate is created once
by hand and referenced in code via `Certificate.fromCertificateArn`. Defining
it in CDK instead would leave CloudFormation stuck in `CREATE_IN_PROGRESS`
waiting on a record only a human can add.

## Settled decisions

- **Region**: us-east-1. CloudFront's certificate must live there regardless;
  a single region avoids a cross-region cert construct.
- **Sign-in**: Google only. No email/password — avoids a password policy,
  email sending, verification and reset flows. Accepted risk: anyone without
  a Google account cannot participate.
- **Auth domain**: `login.scarevenger.app`. Effectively permanent — changing
  it means re-provisioning and updating every OAuth callback URL, including
  in Google Cloud.
- **Event-code gate**: the backend compares the submitted code against the
  Secrets Manager value and sets a `verified` flag on the user's DynamoDB
  record. Chosen over Cognito groups (token-refresh lag, awkward to reset
  between years) and custom attributes (defined at pool creation and never
  removable).
- **AWS account**: must be on the **paid** account plan. The free plan closes
  the account outright when credits are exhausted or at six months, and blocks
  services that can deplete credits. A zero-spend budget alarm is *not* a cap
  and would fire permanently against a stack designed to cost $10–20/month;
  replaced with tiered budgets at $5 / $25 / $50.

## Build order (revised)

Manual prerequisites (outside CDK) come first: upgrade the AWS account,
request the ACM certificate, add the validation CNAME and the placeholder
apex A record in Cloudflare, and create the Google Cloud OAuth client.

1. ~~Secrets Manager~~ — done. Ahead of Cognito because the Google identity
   provider resolves the client secret at deploy time.
2. ~~Cognito User Pool + Google IdP + admin group~~ — done. Custom domain is
   behind a flag; development uses the prefix domain.
3. ~~DynamoDB single table + gsi1~~ — done.
4. Lambda functions + IAM roles — next. Includes the challenge seed script and
   the export handler.
5. API Gateway (HTTP API) with a JWT authorizer
6. S3 bucket (frontend build only)
7. CloudFront (S3 + API Gateway origins, single domain)
8. WAF
9. CloudWatch dashboard + billing alarm, X-Ray tracing

## Auth domain modes

The Cognito custom domain is backed by its own CloudFront distribution: 15-20
minutes to create, the same to delete, so roughly 40 minutes per
destroy-and-rebuild cycle with nearly all of it spent on that one resource.
That is too slow to iterate against while building the remaining constructs.

The stack therefore supports two modes, selected by
`SCAREVENGER_CUSTOM_AUTH_DOMAIN`:

| | Development (default) | Real deployment |
|---|---|---|
| Domain | `scarevenger.auth.us-east-1.amazoncognito.com` | `login.scarevenger.app` |
| Deploy time | ~2 min | ~15-20 min |
| Needs ACM cert | No | Yes |
| Needs a Cloudflare record | No | Yes (`login` CNAME, grey cloud) |

Flipping modes replaces the domain resource, so it costs that wait once — not
on every deploy. Both modes' redirect URIs are registered in Google Cloud up
front so switching never breaks sign-in.

The prefix `scarevenger` must be globally unique within us-east-1. If it is
taken, override with `SCAREVENGER_AUTH_DOMAIN_PREFIX`.

## Teardown gotcha

`cdk destroy` deletes the CDK-managed secrets, but Secrets Manager does not
delete a secret immediately — it schedules deletion with a **30-day recovery
window**. During that window the name is still taken, so the next `cdk deploy`
fails with a name collision on `scarevenger/event-code` and
`scarevenger/drive-admin-credentials`.

CloudFormation has no property to shorten the recovery window, so this is a
manual step after every teardown (and after any failed deploy that rolled
back):

```bash
for s in scarevenger/event-code scarevenger/drive-admin-credentials; do
  aws secretsmanager restore-secret --region us-east-1 --secret-id "$s" 2>/dev/null
  aws secretsmanager delete-secret --region us-east-1 --secret-id "$s" \
    --force-delete-without-recovery 2>/dev/null
done
```

`scarevenger/google-oauth-client-secret` is unaffected — it is created outside
CDK and CloudFormation never touches it.

The alternative was to let CDK auto-generate secret names, which sidesteps
collisions entirely but makes the secrets hard to find in the console when you
need to paste real values in. Predictable names were judged worth the manual
teardown step.

## Status
Scoped and decided through Cognito. Domain registered. Nothing deployed yet —
the manual prerequisites above are the current blocker.
