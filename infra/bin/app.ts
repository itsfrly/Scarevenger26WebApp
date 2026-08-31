#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ScavengerHuntStack } from "../lib/scavenger-hunt-stack";

const app = new cdk.App();

new ScavengerHuntStack(app, "ScavengerHuntStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // Pinned: CloudFront and Cognito custom domains only accept us-east-1
    // certificates.
    region: "us-east-1",
  },
});
