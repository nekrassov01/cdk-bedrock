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

export const exampleParameter: Parameter = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
  terminationProtection: false,
  owner: "user",
  serviceName: "my-service",
  allowedIps: ["0.0.0.0/0"],
  httpProxy: "http://my-proxy.com:port",
  hostZoneName: "user/reponame",
  repository: "example.com",
  slackOAuthToken: "foo",
  slackSigningSecret: "bar",
  hasUI: false,
};
