/**
 * End-to-end check against the deployed stack.
 *
 *   npx tsx backend/scripts/smoke-test.ts
 *
 * Opens the hosted UI, catches the OAuth redirect on localhost:5173, then
 * exercises every route through CloudFront -- which is the path that matters,
 * since it also proves the /api behaviour forwards Authorization correctly.
 *
 * Uses the aws CLI rather than an SDK client so it needs no extra dependency.
 */
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const STACK = "ScavengerHuntStack";
const REGION = "us-east-1";
const REDIRECT_URI = "http://localhost:5173/auth/callback";

const sh = (cmd: string) => execSync(cmd, { encoding: "utf8" }).trim();

function outputs(): Record<string, string> {
  const raw = sh(
    `aws cloudformation describe-stacks --region ${REGION} --stack-name ${STACK} ` +
      `--query "Stacks[0].Outputs" --output json`,
  );
  return Object.fromEntries(
    (JSON.parse(raw) as { OutputKey: string; OutputValue: string }[]).map(
      (o) => [o.OutputKey, o.OutputValue],
    ),
  );
}

/** Serves one request, returns the ?code= it received. */
function catchRedirect(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost:5173");
      const code = url.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        code
          ? "<h1>Signed in. Close this tab.</h1>"
          : `<h1>No code: ${url.searchParams.get("error") ?? "unknown"}</h1>`,
      );
      server.close();
      code ? resolve(code) : reject(new Error("no authorization code returned"));
    });
    server.listen(5173);
    setTimeout(() => {
      server.close();
      reject(new Error("timed out waiting for sign-in"));
    }, 180_000);
  });
}

async function tokens(authBaseUrl: string, clientId: string, code: string) {
  const res = await fetch(`${authBaseUrl}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`);
  return (await res.json()) as { id_token: string; access_token: string };
}

function setVerified(sub: string, value: boolean): void {
  sh(
    `aws dynamodb update-item --region ${REGION} --table-name scarevenger ` +
      `--key '{"pk":{"S":"USER#${sub}"},"sk":{"S":"PROFILE"}}' ` +
      `--update-expression "SET eventVerified = :v" ` +
      `--expression-attribute-values '{":v":{"BOOL":${value}}}'`,
  );
}

/** Reads cognito:groups straight off the id token. */
function groupsFromToken(idToken: string): string[] {
  const payload = JSON.parse(
    Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  const claim = payload["cognito:groups"];
  return Array.isArray(claim) ? (claim as string[]) : [];
}

let passed = 0;
let failed = 0;

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const out = await fn();
    console.log(`  PASS  ${name}`);
    passed++;
    return out;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${(e as Error).message}`);
    failed++;
    return undefined;
  }
}

async function main() {
  const out = outputs();
  const base = `${out.SiteUrl}/api`;
  console.log(`stack:  ${STACK}`);
  console.log(`api:    ${base}`);
  console.log(`auth:   ${out.AuthBaseUrl}\n`);

  const eventCode = sh(
    `aws secretsmanager get-secret-value --region ${REGION} ` +
      `--secret-id scarevenger/event-code --query SecretString --output text`,
  );

  const loginUrl =
    `${out.AuthBaseUrl}/oauth2/authorize?client_id=${out.UserPoolClientId}` +
    `&response_type=code&scope=openid+email+profile` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&identity_provider=Google`;

  console.log("Opening browser to sign in...\n");
  try {
    execSync(`open "${loginUrl}"`);
  } catch {
    console.log(`Open this manually:\n${loginUrl}\n`);
  }

  const { id_token } = await tokens(
    out.AuthBaseUrl,
    out.UserPoolClientId,
    await catchRedirect(),
  );

  const raw = async (method: string, path: string) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${id_token}` },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
    return text;
  };

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${id_token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };

  console.log("\nrunning checks\n");

  await step("the API refuses requests that bypass CloudFront", async () => {
    const apiId = new URL(out.ApiUrl).host;
    const res = await fetch(`https://${apiId}/api/me`, {
      headers: { authorization: `Bearer ${id_token}` },
    });
    if (res.status !== 403) {
      throw new Error(
        `execute-api returned ${res.status}, expected 403 — WAF can be bypassed`,
      );
    }
  });

  // CloudFront errorResponses are distribution-wide, so mapping 403/404 to
  // index.html for SPA routing once swallowed every API error and returned
  // HTML. These two lock that fix in.
  await step("an API 404 stays a 404, not the SPA page", async () => {
    const res = await fetch(`${base}/teams/does-not-exist`, {
      headers: { authorization: `Bearer ${id_token}` },
    });
    const body = await res.text();
    if (body.trimStart().startsWith("<")) {
      throw new Error("got HTML — CloudFront is rewriting API errors");
    }
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  await step("GET /api/me creates the user record", async () => {
    const me = await api("GET", "/me");
    if (!me.sub) throw new Error("no sub returned");
  });

  // Admins bypass the gate by design, so this can only be checked as a
  // regular player. For anyone else, clear the flag first -- otherwise a
  // re-run passes the gate and fails on the bogus challengeId instead.
  const meBefore = await api("GET", "/me");
  const amAdmin = groupsFromToken(id_token).includes("admins");

  if (amAdmin) {
    console.log(
      "  SKIP  event-code gate\n" +
        "        You are an admin, who bypasses it by design. Run as a\n" +
        "        non-admin account to exercise this path.",
    );
  } else {
    await step("POST /api/submissions is rejected before the event code", async () => {
      setVerified(meBefore.sub, false);
      try {
        await api("POST", "/submissions", { challengeId: "x" });
      } catch (e) {
        if ((e as Error).message.startsWith("403")) return;
        throw e;
      }
      throw new Error("expected 403, gate is not enforced");
    });
  }

  await step("POST /api/event-code rejects a wrong code", async () => {
    try {
      await api("POST", "/event-code", { code: "definitely-wrong" });
    } catch (e) {
      if ((e as Error).message.startsWith("403")) return;
      throw e;
    }
    throw new Error("wrong code was accepted");
  });

  await step("POST /api/event-code accepts the real code", () =>
    api("POST", "/event-code", { code: eventCode }),
  );

  const challenges = await step("GET /api/challenges returns seeded data", async () => {
    const list = await api("GET", "/challenges");
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error("no challenges - run seed-challenges.ts first");
    }
    return list;
  });

  const me = await api("GET", "/me");
  let teamId: string | undefined = me.teamId;

  if (!teamId) {
    const team = await step("POST /api/teams creates a team", () =>
      api("POST", "/teams", { name: `Smoke Test ${randomUUID().slice(0, 6)}` }),
    );
    teamId = team?.teamId;
  } else {
    console.log(`  SKIP  team creation (already on team ${teamId})`);
  }

  await step("GET /api/teams/{id} returns team, members, submissions", async () => {
    const d = await api("GET", `/teams/${teamId}`);
    if (!d.team || !Array.isArray(d.members) || !Array.isArray(d.submissions)) {
      throw new Error("dashboard shape is wrong");
    }
  });

  const photoChallenge = (challenges ?? []).find(
    (c: any) => c.proofType === "photo" && c.type === "standard",
  );

  const upload = await step("POST /api/uploads returns a presigned POST", () =>
    api("POST", "/uploads", {
      challengeId: photoChallenge?.challengeId,
      contentType: "image/png",
    }),
  );

  await step("presigned POST accepts a small PNG", async () => {
    // 1x1 transparent PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const form = new FormData();
    for (const [k, v] of Object.entries(upload!.fields as Record<string, string>)) {
      form.append(k, v);
    }
    form.append("file", new Blob([png], { type: "image/png" }), "test.png");
    const res = await fetch(upload!.url, { method: "POST", body: form });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  });

  await step("POST /api/submissions rejects a forged key", async () => {
    try {
      await api("POST", "/submissions", {
        challengeId: photoChallenge?.challengeId,
        files: [{ key: "media/someone-else/x/y.png", contentType: "image/png" }],
      });
    } catch (e) {
      if ((e as Error).message.startsWith("400")) return;
      throw e;
    }
    throw new Error("forged key was accepted");
  });

  await step("POST /api/submissions accepts the real upload and scores it", async () => {
    await api("POST", "/submissions", {
      challengeId: photoChallenge?.challengeId,
      files: [{ key: upload!.key, contentType: "image/png" }],
    });
    const d = await api("GET", `/teams/${teamId}`);
    if (d.team.score !== photoChallenge.points) {
      throw new Error(`score ${d.team.score}, expected ${photoChallenge.points}`);
    }
  });

  await step("media is readable through CloudFront", async () => {
    const res = await fetch(`${out.SiteUrl}/${upload!.key}`);
    if (!res.ok) throw new Error(`${res.status} reading /${upload!.key}`);
  });

  await step("GET /api/scoreboard lists teams", async () => {
    const list = await api("GET", "/scoreboard");
    if (!Array.isArray(list)) throw new Error("not an array");
  });

  let isAdmin = amAdmin;
  await step("GET /api/admin/export returns a CSV scoreboard", async () => {
    try {
      const csv = await raw("GET", "/admin/export?format=csv");
      if (!csv.startsWith("Team,Score")) {
        throw new Error(`unexpected CSV header: ${csv.slice(0, 60)}`);
      }
      if (csv.trim().split("\n").length < 2) {
        throw new Error("CSV has a header but no team rows");
      }
      isAdmin = true;
      console.log("        (admin; CSV parsed, paper fallback works)");
    } catch (e) {
      if ((e as Error).message.startsWith("403")) {
        console.log("        (403 - not in the admins group; judge checks skipped)");
        return;
      }
      throw e;
    }
  });

  if (!isAdmin) {
    console.log(
      "\n  SKIP  judging and ranked scoring\n" +
        "        Add yourself to the `admins` group in the Cognito console\n" +
        "        and re-run to exercise them.",
    );
  } else {
    const cid = photoChallenge.challengeId;

    await step("judge rejection removes the points", async () => {
      await api("POST", `/judge/submissions/${teamId}/${cid}`, {
        status: "rejected",
        note: "smoke test",
      });
      const d = await api("GET", `/teams/${teamId}`);
      if (d.team.score !== 0) throw new Error(`score ${d.team.score}, expected 0`);
    });

    await step("un-rejecting restores them", async () => {
      await api("POST", `/judge/submissions/${teamId}/${cid}`, {
        status: "submitted",
      });
      const d = await api("GET", `/teams/${teamId}`);
      if (d.team.score !== photoChallenge.points) {
        throw new Error(`score ${d.team.score}, expected ${photoChallenge.points}`);
      }
    });

    const ranked = (challenges ?? []).find((c: any) => c.type === "ranked");

    await step("placements on a ranked challenge award its points", async () => {
      await api("PUT", `/judge/challenges/${ranked.challengeId}/placements`, {
        placements: [{ place: 1, teamIds: [teamId] }],
      });
      const d = await api("GET", `/teams/${teamId}`);
      const expected = photoChallenge.points + ranked.awards[0].points;
      if (d.team.score !== expected) {
        throw new Error(`score ${d.team.score}, expected ${expected}`);
      }
    });

    await step("moving a team down a place recomputes both ways", async () => {
      await api("PUT", `/judge/challenges/${ranked.challengeId}/placements`, {
        placements: [{ place: 3, teamIds: [teamId] }],
      });
      const d = await api("GET", `/teams/${teamId}`);
      const third = ranked.awards.find((a: any) => a.place === 3).points;
      const expected = photoChallenge.points + third;
      if (d.team.score !== expected) {
        throw new Error(`score ${d.team.score}, expected ${expected}`);
      }
    });

    await step("a place with no matching award is rejected", async () => {
      try {
        await api("PUT", `/judge/challenges/${ranked.challengeId}/placements`, {
          placements: [{ place: 9, teamIds: [teamId] }],
        });
      } catch (e) {
        if ((e as Error).message.startsWith("400")) return;
        throw e;
      }
      throw new Error("invalid place was accepted");
    });

    await step("clearing placements removes the ranked points", async () => {
      await api("PUT", `/judge/challenges/${ranked.challengeId}/placements`, {
        placements: [],
      });
      const d = await api("GET", `/teams/${teamId}`);
      if (d.team.score !== photoChallenge.points) {
        throw new Error(`score ${d.team.score}, expected ${photoChallenge.points}`);
      }
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`\nfatal: ${e.message}`);
  process.exit(1);
});
