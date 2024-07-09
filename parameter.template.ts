import { Environment } from "aws-cdk-lib";

export interface Parameter {
  env?: Environment;
  terminationProtection: boolean;
  owner: string;
  serviceName: string;
  allowedIps: string[];
  httpProxy: string;
  hostZoneName: string;
  repository: string;
  slackOAuthToken: string;
  slackSigningSecret: string;
  hasUI: boolean;
}

/**
First, Create `parameter.ts` to set your parameters as follows:
*/

/**
import { Parameter } from "./parameter.template";

export const parameter: Parameter = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
  terminationProtection: false,
  owner: "stack-creator",
  serviceName: "test-service",
  allowedIps: ["0.0.0.0/0"],
  httpProxy: "http://your-proxy.com:port",
  hostZoneName: "your-domain.com",
  repository: "user/your-app",
  slackOAuthToken: "foo",
  slackSigningSecret: "bar",
  hasUI: false,
};
*/
