// Writes frontend/.env.local from the deployed stack outputs.
//   npx tsx backend/scripts/write-frontend-env.ts
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const REGION = "us-east-1";
const raw = execSync(
  `aws cloudformation describe-stacks --region ${REGION} ` +
    `--stack-name ScavengerHuntStack --query "Stacks[0].Outputs" --output json`,
  { encoding: "utf8" },
);
const out = Object.fromEntries(
  (JSON.parse(raw) as { OutputKey: string; OutputValue: string }[]).map((o) => [
    o.OutputKey,
    o.OutputValue,
  ]),
);

const file = [
  `VITE_PROXY_TARGET=${out.SiteUrl}`,
  `VITE_AUTH_AUTHORITY=https://cognito-idp.${REGION}.amazonaws.com/${out.UserPoolId}`,
  `VITE_AUTH_CLIENT_ID=${out.UserPoolClientId}`,
  `VITE_AUTH_DOMAIN=${out.AuthBaseUrl}`,
  "",
].join("\n");

const target = path.join(process.cwd(), "frontend/.env.local");
writeFileSync(target, file);
console.log(`wrote ${target}\n`);
console.log(file);
