import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "node:path";

export interface ApiProps {
  readonly table: dynamodb.Table;
  readonly mediaBucket: s3.Bucket;
  readonly eventCode: secretsmanager.Secret;
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly originSecret: secretsmanager.Secret;
}

const HANDLERS = path.join(__dirname, "../../../backend/src/handlers");

export class Api extends Construct {
  readonly httpApi: apigw.HttpApi;
  readonly functions: NodejsFunction[];

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    // Validates the Cognito token before the request reaches a Lambda, so
    // unauthenticated traffic costs nothing. It cannot check eventVerified --
    // that is a DB lookup, done in shared middleware.
    const authorizer = new HttpJwtAuthorizer(
      "JwtAuthorizer",
      props.userPool.userPoolProviderUrl,
      {
        jwtAudience: [props.userPoolClient.userPoolClientId],
        identitySource: ["$request.header.Authorization"],
      },
    );

    this.httpApi = new apigw.HttpApi(this, "HttpApi", {
      apiName: "scarevenger",
      defaultAuthorizer: authorizer,
      // CloudFront serves the app and API under one domain, so no CORS.
    });

    const me = this.fn("Me", "me.ts", props, {
      EVENT_CODE_SECRET_ARN: props.eventCode.secretArn,
    });
    const teams = this.fn("Teams", "teams.ts", props);
    const challenges = this.fn("Challenges", "challenges.ts", props);
    const uploads = this.fn("Uploads", "uploads.ts", props);
    const judge = this.fn("Judge", "judge.ts", props);
    const admin = this.fn("Admin", "admin.ts", props);

    // Scoped per function rather than one shared role. Read/write is the
    // finest useful grain here: DynamoDB IAM conditions can pin leading keys
    // to an identity, but not to a prefix like USER#*, so action-level
    // scoping is the honest limit.
    props.table.grantReadWriteData(me);
    props.table.grantReadWriteData(teams);
    props.table.grantReadWriteData(challenges);
    props.table.grantReadWriteData(judge);
    props.table.grantReadData(uploads);
    // Presigning needs PutObject; HeadObject verifies the upload landed.
    props.mediaBucket.grantPut(uploads);
    props.mediaBucket.grantRead(challenges);
    props.table.grantReadWriteData(admin);
    props.eventCode.grantRead(me);
    for (const fn of [me, teams, challenges, uploads, judge, admin]) {
      props.originSecret.grantRead(fn);
    }

    this.functions = [me, teams, challenges, uploads, judge, admin];

    this.route("GET", "/api/me", me);
    this.route("POST", "/api/event-code", me);
    this.route("GET", "/api/teams", teams);
    this.route("POST", "/api/teams", teams);
    this.route("GET", "/api/teams/{id}", teams);
    this.route("POST", "/api/teams/join", teams);
    this.route("GET", "/api/scoreboard", teams);
    this.route("GET", "/api/challenges", challenges);
    this.route("POST", "/api/submissions", challenges);
    this.route("POST", "/api/uploads", uploads);
    this.route("GET", "/api/judge/submissions", judge);
    this.route("POST", "/api/judge/submissions/{teamId}/{challengeId}", judge);
    this.route("PUT", "/api/judge/challenges/{id}/placements", judge);
    this.route("PUT", "/api/admin/challenges", admin);
    this.route("POST", "/api/admin/recalculate", admin);
    this.route("POST", "/api/admin/players/{sub}/team", admin);
    this.route("DELETE", "/api/admin/challenges/{id}", admin);
    this.route("GET", "/api/admin/export", admin);
  }

  private fn(
    id: string,
    entry: string,
    props: ApiProps,
    extraEnv: Record<string, string> = {},
  ): NodejsFunction {
    return new NodejsFunction(this, id, {
      entry: path.join(HANDLERS, entry),
      runtime: lambda.Runtime.NODEJS_22_X,
      // Cheaper per ms and faster than x86 for this workload.
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      logGroup: new logs.LogGroup(this, `${id}Logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        TABLE_NAME: props.table.tableName,
        MEDIA_BUCKET: props.mediaBucket.bucketName,
        ORIGIN_SECRET_ARN: props.originSecret.secretArn,
        POWERTOOLS_SERVICE_NAME: "scarevenger",
        POWERTOOLS_METRICS_NAMESPACE: "Scarevenger",
        ...extraEnv,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        // Provided by the runtime; bundling it wastes ~10MB and cold-start ms.
        externalModules: ["@aws-sdk/*"],
      },
    });
  }

  // Routes carry the /api prefix so CloudFront forwards the path unchanged.
  // The alternative -- a CloudFront Function stripping the prefix -- is one
  // more moving part for no benefit, since nothing else consumes this API.
  private route(method: string, routePath: string, fn: NodejsFunction): void {
    this.httpApi.addRoutes({
      path: routePath,
      methods: [apigw.HttpMethod[method as keyof typeof apigw.HttpMethod]],
      integration: new HttpLambdaIntegration(
        `${method}${routePath}`.replace(/[^A-Za-z0-9]/g, ""),
        fn,
      ),
    });
  }
}
