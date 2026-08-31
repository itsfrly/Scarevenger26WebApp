import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface CicdProps {
  /** e.g. "itsfrly/Scarevenger26WebApp" */
  readonly repository: string;
  /** Branch allowed to deploy. */
  readonly branch: string;
  /**
   * True if this account already has a GitHub OIDC provider. Only one per
   * account is allowed, so a second CreateOpenIDConnectProvider fails.
   */
  readonly providerExists: boolean;
}

const GITHUB_ISSUER = "token.actions.githubusercontent.com";
/** CDK's default bootstrap qualifier. */
const QUALIFIER = "hnb659fds";

/**
 * Federated role for GitHub Actions. No access keys anywhere -- Actions
 * exchanges a short-lived OIDC token for temporary credentials.
 *
 * The role itself has almost no permissions. All it can do is assume the CDK
 * bootstrap roles, which is what actually performs the deployment. That keeps
 * the blast radius of a compromised workflow to "can deploy this stack"
 * rather than "is an account admin".
 */
export class Cicd extends Construct {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: CicdProps) {
    super(scope, id);

    const { account, region } = cdk.Stack.of(this);
    const [owner, repo] = props.repository.split("/");
    if (!owner || !repo) {
      throw new Error(`repository must be "owner/name", got: ${props.repository}`);
    }

    const provider = props.providerExists
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "GithubOidc",
          `arn:aws:iam::${account}:oidc-provider/${GITHUB_ISSUER}`,
        )
      : new iam.OpenIdConnectProvider(this, "GithubOidc", {
          url: `https://${GITHUB_ISSUER}`,
          clientIds: ["sts.amazonaws.com"],
        });

    this.role = new iam.Role(this, "DeployRole", {
      roleName: "scarevenger-github-deploy",
      description: "Assumed by GitHub Actions to deploy the Scarevenger stack",
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            [`${GITHUB_ISSUER}:aud`]: "sts.amazonaws.com",
          },
          // Pinned to one branch of one repo. Without this condition any
          // GitHub repository in the world could assume the role.
          //
          // Two patterns because GitHub changed the subject format: repos
          // created after 2026-07-15 emit immutable owner and repository ids
          // (repo:owner@123/name@456:...) instead of bare names. The `@*`
          // only matches that id segment -- owner logins cannot contain `@`,
          // so this cannot widen to a different owner.
          //
          // Note this matches on the branch ref, which means the deploy job
          // must NOT declare a GitHub `environment:`. Doing so replaces the
          // ref in the subject with `environment:<name>` and the match fails.
          StringLike: {
            [`${GITHUB_ISSUER}:sub`]: [
              `repo:${props.repository}:ref:refs/heads/${props.branch}`,
              `repo:${owner}@*/${repo}@*:ref:refs/heads/${props.branch}`,
            ],
          },
        },
      ),
    });

    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          `arn:aws:iam::${account}:role/cdk-${QUALIFIER}-deploy-role-${account}-${region}`,
          `arn:aws:iam::${account}:role/cdk-${QUALIFIER}-file-publishing-role-${account}-${region}`,
          `arn:aws:iam::${account}:role/cdk-${QUALIFIER}-image-publishing-role-${account}-${region}`,
          `arn:aws:iam::${account}:role/cdk-${QUALIFIER}-lookup-role-${account}-${region}`,
        ],
      }),
    );

    // write-frontend-env.ts reads the outputs before building the frontend.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [
          `arn:aws:cloudformation:${region}:${account}:stack/${cdk.Stack.of(this).stackName}/*`,
        ],
      }),
    );
  }
}
