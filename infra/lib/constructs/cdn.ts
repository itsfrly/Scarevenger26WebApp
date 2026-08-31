import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import { existsSync } from "node:fs";
import * as path from "node:path";

export interface CdnProps {
  readonly mediaBucket: s3.Bucket;
  readonly httpApi: apigw.HttpApi;
  readonly webAclArn: string;
  readonly originSecret: secretsmanager.Secret;
  /** Apex domain + certificate, or undefined to use the *.cloudfront.net name. */
  readonly customDomain?: {
    readonly domainName: string;
    readonly certificateArn: string;
  };
}

/**
 * One distribution serving the app, the API and uploaded media under a single
 * origin, which is what removes CORS from the picture entirely.
 */
export class Cdn extends Construct {
  readonly distribution: cloudfront.Distribution;
  readonly siteBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: CdnProps) {
    super(scope, id);

    // Build output only. Disposable, so it is emptied and deleted with the
    // stack -- unlike the media bucket.
    this.siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // SPA routing is done by rewriting the path BEFORE it reaches an origin,
    // not with errorResponses.
    //
    // errorResponses are distribution-wide with no path scoping, so mapping
    // 403/404 to index.html silently swallowed every 403 and 404 the API
    // returned -- the event-code gate, the admin checks, "not found" -- and
    // handed the caller HTML instead. This rewrite only runs on the default
    // behaviour, so API and media responses pass through untouched.
    //
    // CloudFront Functions run a restricted JS runtime: no startsWith,
    // no includes, no template literals.
    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      comment: "Serve index.html for client-side routes",
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.indexOf('/api/') === 0 || uri.indexOf('/media/') === 0) {
    return request;
  }
  var last = uri.substring(uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') !== -1) {
    return request;
  }
  request.uri = '/index.html';
  return request;
}
      `),
    });

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "scarevenger",
      webAclId: props.webAclArn,
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      // North America and Europe. The event is in one town.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      // Only meaningful with a custom certificate; CloudFront's default cert
      // has a fixed security policy and CDK warns if this is set without one.
      ...(props.customDomain
        ? {
            domainNames: [props.customDomain.domainName],
            certificate: acm.Certificate.fromCertificateArn(
              this,
              "SiteCertificate",
              props.customDomain.certificateArn,
            ),
            minimumProtocolVersion:
              cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
          }
        : {}),

      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy:
          cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        functionAssociations: [
          {
            function: spaRewrite,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },

      additionalBehaviors: {
        // Never cached, and the Authorization header must reach Lambda. The
        // ALL_VIEWER_EXCEPT_HOST_HEADER policy is required for an API Gateway
        // origin: forwarding the viewer Host header breaks SNI at the origin.
        "/api/*": {
          origin: new origins.HttpOrigin(
            `${props.httpApi.apiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com`,
            {
              // Proves a request came through CloudFront. The execute-api URL
              // is public and bypasses WAF, so the API rejects anything
              // without this header.
              customHeaders: {
                "x-origin-verify": props.originSecret.secretValue.unsafeUnwrap(),
              },
            },
          ),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },

        // Immutable objects under UUID keys, so cache hard.
        "/media/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(
            props.mediaBucket,
          ),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },

    });

    this.deploySite();
  }

  /**
   * Uploads the Vite build and invalidates the cache.
   *
   * Skipped when frontend/dist is missing so the stack can be deployed before
   * the frontend has ever been built -- a missing directory would otherwise
   * fail synth, not just deploy.
   */
  private deploySite(): void {
    const dist = path.join(__dirname, "../../../frontend/dist");
    if (!existsSync(dist)) {
      cdk.Annotations.of(this).addWarningV2(
        "scarevenger:no-frontend-build",
        "frontend/dist not found - skipping site deployment. Run `npm run build --workspace=frontend` first.",
      );
      return;
    }

    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [s3deploy.Source.asset(dist)],
      destinationBucket: this.siteBucket,
      distribution: this.distribution,
      // index.html must never be served stale, or people keep loading an old
      // bundle after a deploy. Hashed assets are immutable and cached hard by
      // the default behaviour.
      distributionPaths: ["/index.html"],
      prune: true,
    });
  }

  get url(): string {
    return `https://${this.distribution.distributionDomainName}`;
  }
}
