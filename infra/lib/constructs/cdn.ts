import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface CdnProps {
  readonly mediaBucket: s3.Bucket;
  readonly httpApi: apigw.HttpApi;
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

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "scarevenger",
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
      },

      additionalBehaviors: {
        // Never cached, and the Authorization header must reach Lambda. The
        // ALL_VIEWER_EXCEPT_HOST_HEADER policy is required for an API Gateway
        // origin: forwarding the viewer Host header breaks SNI at the origin.
        "/api/*": {
          origin: new origins.HttpOrigin(
            `${props.httpApi.apiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com`,
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

      // SPA routing: the client router owns every path, so a missing key is
      // index.html rather than an error. 200, not 404, or the browser will not
      // render the app.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });
  }

  get url(): string {
    return `https://${this.distribution.distributionDomainName}`;
  }
}
