#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BedrockStack } from "../lib/stack";

const app = new cdk.App();

new BedrockStack(app, "BedrockStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
  terminationProtection: false,
  serviceName: app.node.tryGetContext("serviceName"),
  allowedIps: app.node.tryGetContext("allowedIps"),
  httpProxy: app.node.tryGetContext("httpProxy"),
  hostZoneName: app.node.tryGetContext("hostZoneName"),
  repository: app.node.tryGetContext("repository"),
});

cdk.Tags.of(app).add("Owner", app.node.tryGetContext("owner"));
