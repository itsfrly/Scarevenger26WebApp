# Manual prerequisites

Steps that cannot be done in CDK. Everything in the stack is blocked on
these. Work top to bottom.

---

## 0. Stop using root — set up IAM Identity Center

Do this first, so every step below is performed as your Identity Center
identity rather than root.

An IAM *user* with `AdministratorAccess` is the decade-old version of this
advice. It means long-lived access keys sitting in `~/.aws/credentials` in
plaintext — the leading cause of AWS account compromise, and a visible
anti-pattern in a project whose point is demonstrating cloud-architecture
judgment. Use IAM Identity Center instead: short-lived credentials, browser
MFA, no static keys on disk.

### Enable it

1. IAM Identity Center console, **us-east-1**. Enabling it creates an AWS
   Organization automatically (free) with this account as the management
   account.
2. Create a user for yourself; register MFA.
3. Create a permission set — `AdministratorAccess` is fine for now — and
   assign yourself to the account.
4. Note the **AWS access portal URL** from the dashboard. It looks like
   `https://d-xxxxxxxxxx.awsapps.com/start`.

The instance region is a **one-way door**: changing it later means deleting
and recreating the instance, losing users, groups, permission sets and
assignments, and the portal URL changes. us-east-1 matches the rest of the
stack. The region does *not* limit which regions you can administer —
permission sets provision IAM roles, and IAM is global.

### Harden root, then walk away from it

- Hardware or virtual MFA on the root user
- Confirm no root access keys exist (delete any that do)
- Strong unique password in a password manager
- Set the alternate billing and security contacts

Root is then used for essentially nothing: closing the account, changing the
support plan, a few account-level settings.

### Log in from the AWS CLI

Requires **AWS CLI v2** — v1 has no SSO support at all.

```bash
aws --version   # must report aws-cli/2.x
```

Configure the profile once:

```bash
aws configure sso
```

Answer as follows:

| Prompt | Value |
|---|---|
| SSO session name | `scarevenger` |
| SSO start URL | your `https://d-xxxxxxxxxx.awsapps.com/start` |
| SSO region | `us-east-1` |
| SSO registration scopes | accept the default `sso:account:access` |

A browser opens for sign-in and device approval. Then:

| Prompt | Value |
|---|---|
| CLI default client Region | `us-east-1` |
| CLI default output format | `json` |
| CLI profile name | `scarevenger` |

This writes `~/.aws/config` and **nothing** to `~/.aws/credentials` — that is
the entire point. If a `[default]` block with static keys already exists in
`~/.aws/credentials`, delete it; a stale default profile silently wins over
what you expect and you end up authenticating as something you forgot about.

### Daily use

```bash
aws sso login --profile scarevenger
aws sts get-caller-identity --profile scarevenger
```

To avoid typing `--profile` on everything:

```bash
export AWS_PROFILE=scarevenger
```

When the session expires, `aws sso login` again. `aws sso logout` clears the
cached token.

### CDK

CDK v2 reads SSO credentials natively through the SDK credential chain — no
`yawsso` shim needed. Bootstrap once per account/region, then deploy:

```bash
cdk bootstrap aws://<account-id>/us-east-1 --profile scarevenger
cdk deploy --profile scarevenger
```

### Leave the deploy identity as admin for now

Least-privilege CDK deployment permissions are genuinely painful — the stack
creates IAM roles, Cognito pools, CloudFront distributions and WAF rules, and
deriving the minimal policy is an afternoon of iterating on `AccessDenied`.
Admin behind MFA with one-hour credentials is a reasonable place to be. The
narrow policy earns its keep on the **GitHub Actions OIDC role** instead,
since that runs unattended.

---

## 1. Upgrade the AWS account to the paid plan

Console → **Billing and Cost Management** → **Free tier** → **Upgrade plan**.

This is a one-way door — there is no downgrade. It is not optional: the free
account plan *closes the account* when credits run out or at six months,
whichever comes first, and blocks services that can deplete credits (which is
why Route 53 domain registration was refused). Remaining credits carry over.

## 2. Replace the zero-spend budget

A zero-spend alarm is a notification, not a cap — AWS has no hard spending
limit — and it would fire permanently against a stack designed to cost
$10–20/month. An alarm that is always on is an alarm you stop reading.

AWS Budgets → create three cost budgets, each alerting at 100% actual and 80%
forecasted:

| Budget | Meaning |
|---|---|
| $5 | Early warning. Before the stack is complete, crossing $5 is unexpected. |
| $25 | Above the expected ceiling. Go look. |
| $50 | Something is wrong — misconfigured WAF rule, runaway Lambda, CloudFront origin loop. |

## 3. Request the ACM certificate

**Region must be N. Virginia (us-east-1)** — CloudFront and Cognito custom
domains only accept certificates from that region, regardless of where the
rest of the stack lives.

### Console click path

1. Sign in to the AWS console. **Switch the region selector (top right) to
   `US East (N. Virginia) us-east-1` before doing anything else.** This is the
   single most common mistake here — a certificate requested in the wrong
   region is invisible to CloudFront and Cognito, and cannot be moved. You
   would have to request a new one.
2. Search for **Certificate Manager** → open ACM.
3. **Request a certificate**.
4. Certificate type: **Request a public certificate** → Next.
5. Fully qualified domain name: `scarevenger.app`
6. **Add another name to this certificate** → `*.scarevenger.app`
7. Validation method: **DNS validation – recommended**.
8. Key algorithm: leave the default (**RSA 2048**).
9. Tags: optional. → **Request**.

You land on the certificate detail page with status **Pending validation**.

### Getting the validation record

Scroll to the **Domains** section. It lists two rows — one per domain name —
but **both rows show the identical CNAME name and value**. The wildcard
validates against the base domain, so you create **one** record, not two.

There is a **"Create records in Route 53"** button. **Ignore it.** You have no
Route 53 hosted zone; it will either fail or create a zone you do not want and
will be billed for.

Use the copy icons next to the CNAME **name** and **value** — copying by hand
is how the trailing-dot and appended-zone mistakes happen.

### Alternative: CLI

If you have the AWS CLI configured on your Mac, this is less error-prone than
the console because it prints the record verbatim:

```bash
aws acm request-certificate \
  --region us-east-1 \
  --domain-name scarevenger.app \
  --subject-alternative-names "*.scarevenger.app" \
  --validation-method DNS \
  --query CertificateArn --output text
```

Then read back the record to create:

```bash
aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn <arn-from-above> \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord' \
  --output table
```

Leave the console tab open — you need the record values for the next step, and
the certificate ARN afterward.

### Things that will bite you

- **Certificates are free.** There is no charge for a public ACM certificate,
  so nothing here affects the budget.
- A certificate stuck in **Pending validation** for **72 hours** fails
  permanently. You cannot retry validation on a failed certificate — you have
  to request a new one. If the status has not flipped within an hour, the DNS
  record is wrong; check for the appended zone name and the trailing dot.
- DNS-validated certificates **auto-renew indefinitely** as long as the
  validation CNAME stays in place. That is why the record must never be
  deleted.

## 4. Add the DNS records in Cloudflare

Cloudflare dashboard → `scarevenger.app` → **DNS** → **Records**.

### 4a. Certificate validation record

| Field | Value |
|---|---|
| Type | CNAME |
| Name | the `_abc123…` portion **only** |
| Target | the `_xyz….acm-validations.aws` value |
| Proxy status | **DNS only (grey cloud)** |
| TTL | Auto |

Two footguns here, both common:

- **Cloudflare auto-appends the zone name.** ACM shows the full
  `_abc123.scarevenger.app.` — paste only `_abc123`. If you paste the whole
  thing you get `_abc123.scarevenger.app.scarevenger.app` and validation
  silently never completes.
- **Strip the trailing dot** from the target value.
- Proxying this record breaks validation. Grey cloud, always.

This record must **stay forever**. It is what lets the certificate auto-renew;
delete it and the cert expires and the site dies, with no HTTP fallback
because `.app` is HSTS-preloaded.

### 4b. Apex placeholder A record

| Field | Value |
|---|---|
| Type | A |
| Name | `@` |
| IPv4 | `192.0.2.1` |
| Proxy status | **DNS only (grey cloud)** |
| TTL | Auto |

Cognito refuses to create a custom domain unless the parent domain has a
resolving A record — an SOA record is not sufficient. `192.0.2.1` is reserved
TEST-NET-1 space, guaranteed unroutable, and exists purely to satisfy that
check. It gets replaced by the CloudFront alias at build step 7.

### 4c. Wait for issuance

ACM status goes **Pending validation → Issued**, usually within a few minutes,
occasionally up to 30. Once issued, copy the **certificate ARN**.

## 5. Create the Google Cloud OAuth client

`console.cloud.google.com` → new project (e.g. "Scarevenger").

### OAuth consent screen

- User type: **External**
- App name: Scarevenger; fill in support and developer contact emails
- Scopes: **`openid`, `email`, `profile` only**

Request nothing beyond those three. They are non-sensitive scopes, which means
you can move the app to **Production** without triggering Google's verification
review. Do publish to Production — leaving it in Testing caps you at 100 users
and requires adding every player's email address by hand, which defeats the
point of a shared event code.

### Credentials → OAuth client ID → Web application

| Field | Value |
|---|---|
| Authorized JavaScript origins | `https://scarevenger.app`, `http://localhost:5173` |
| Authorized redirect URIs | **both** of the two below |

```
https://scarevenger.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
https://login.scarevenger.app/oauth2/idpresponse
```

**Register both.** The stack has two auth-domain modes: development uses the
free Cognito prefix domain (deploys in ~2 minutes), the real deployment uses
the custom domain (~15-20 minutes to create, the same to delete). Each mode
has a different redirect URI, and Google allows multiple — so registering both
now means switching modes never breaks sign-in.

That redirect path is fixed by Cognito; `/oauth2/idpresponse` is not
configurable. Google accepts the URIs before either domain resolves, so this
can be done now.

Save the **Client ID** and **Client secret**.

## 5b. Store the Google client secret in Secrets Manager

Cognito needs the real value at deploy time, so this secret must exist and hold
the true value **before** the first `cdk deploy`. CDK references it; it does not
create it.

Secrets Manager console (us-east-1) → **Store a new secret**:

- Secret type: **Other type of secret**
- Switch to the **Plaintext** tab and **replace the entire contents** with the
  raw client secret — just the string, nothing else
- Secret name: **`scarevenger/google-oauth-client-secret`** (exactly this)
- Rotation: off

**The Plaintext-tab detail matters.** Secrets Manager defaults to the key/value
editor, which stores the value as JSON like `{"key":"GOCSPX-..."}`. CDK
resolves this secret with a dynamic reference that returns the *whole*
`SecretString`, so a JSON-wrapped value hands Cognito the literal text
`{"key":"GOCSPX-..."}` as the OAuth client secret. Google then rejects every
sign-in with an opaque `invalid_client` error, and nothing in the AWS console
looks wrong. Store it as bare plaintext.

Note also that dynamic references resolve at **deploy** time. If you ever
rotate this secret in Google Cloud, updating Secrets Manager is not enough —
you have to redeploy for Cognito to pick it up.

---

## 6. Hand back

Needed to continue the build:

- The **ACM certificate ARN**
- The **Google OAuth Client ID**

Both are passed to CDK as context values, never committed:

```bash
cdk deploy \
  -c certificateArn=arn:aws:acm:us-east-1:<account>:certificate/<id> \
  -c googleClientId=<id>.apps.googleusercontent.com
```

**Do not paste the Google client secret into chat or commit it anywhere.** It
goes directly into Secrets Manager through the console once the secret
placeholder exists (build step 1), and CDK references it by name.

## 6b. Cutting over to the custom domain

Development runs on the Cognito prefix domain and the `*.cloudfront.net` name,
so no DNS is involved. The cutover has an ordering trap: **Cognito checks the
parent domain's A record when it creates the custom domain**, so the
`192.0.2.1` placeholder must still be there at that moment. Do not replace it
first.

### 1. Deploy with the flag on

Locally:

```bash
export SCAREVENGER_CERT_ARN=$(aws acm list-certificates --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='scarevenger.app'].CertificateArn" \
  --output text)
export SCAREVENGER_CUSTOM_AUTH_DOMAIN=true
cd infra && cdk deploy
```

Or via CI: add the `CERT_ARN` secret and set the `CUSTOM_AUTH_DOMAIN` variable
to `true`, then push. Set both together — the variable without the secret
fails at synth.

Expect **15-20 minutes**. Cognito is provisioning its own CloudFront
distribution behind the scenes.

### 2. Point DNS at it

From the stack outputs, in Cloudflare, **both DNS only (grey cloud)**:

| Name | Type | Value |
|---|---|---|
| `login` | CNAME | the `AuthDnsTarget` output |
| `@` | CNAME | the host part of the `SiteUrl` output |

The apex CNAME replaces the `192.0.2.1` placeholder, which has done its job
once the Cognito domain exists. Cloudflare flattens a CNAME at the apex, which
is why this works at all.

`login` **must** be grey. Proxying a Cognito custom domain breaks it — the
distribution does its own host and SNI validation.

### 3. Rebuild the frontend

`VITE_AUTH_DOMAIN` changes from the prefix domain to `login.scarevenger.app`,
and Vite inlines it at build time. A stale bundle keeps redirecting to the old
hosted UI:

```bash
npx tsx backend/scripts/write-frontend-env.ts
npm run build --workspace=frontend
cd infra && cdk deploy
```

CI does this automatically — it regenerates the env from stack outputs before
building.

### 4. Verify

```bash
npx tsx backend/scripts/smoke-test.ts
```

Google already has both redirect URIs registered, so nothing changes there.

### Rolling back

Unset `SCAREVENGER_CUSTOM_AUTH_DOMAIN` and redeploy. The Cognito domain is
destroyed and recreated as the prefix domain, which costs the 15-20 minutes
again in each direction.

## 7. Housekeeping

There is a stale `.git/index.lock` blocking commits, and Cowork's shell on the
Mac cannot delete files. Run this yourself, then commit the scaffold as a
baseline so the CDK work lands as a reviewable diff:

```
rm .git/index.lock
git add -A && git commit -m "Scaffold monorepo + architecture decisions"
```
