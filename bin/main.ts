#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BedrockStack } from "../lib/stack";
import { parameter } from "../parameter";

const app = new cdk.App();

new BedrockStack(app, "BedrockStack", {
  env: {
    account: parameter.env?.account,
    region: parameter.env?.region,
  },
  terminationProtection: parameter.terminationProtection,
  serviceName: parameter.serviceName,
  allowedIps: parameter.allowedIps,
  httpProxy: parameter.httpProxy,
  hostZoneName: parameter.hostZoneName,
  repository: parameter.repository,
  slackOAuthToken: parameter.slackOAuthToken,
  slackSigningSecret: parameter.slackSigningSecret,
  hasUI: parameter.hasUI,
});

cdk.Tags.of(app).add("Owner", parameter.owner);
