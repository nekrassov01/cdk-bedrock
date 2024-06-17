import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Bedrock } from "./constructs/bedrock";
import { Function } from "./constructs/function";
import { Ecs } from "./constructs/ecs";

export interface BedrockStackProps extends cdk.StackProps {
  serviceName: string;
  allowedIps: string[];
  httpProxy: string;
  hostZoneName: string;
  repository: string;
}

export class BedrockStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BedrockStackProps) {
    super(scope, id, props);

    const fn = new Function(this, "Function", {
      serviceName: props.serviceName,
      httpProxy: props.httpProxy,
    });

    const bedrock = new Bedrock(this, "Bedrock", {
      serviceName: props.serviceName,
      alias: fn.alias,
    });

    new Ecs(this, "ECS", {
      serviceName: props.serviceName,
      allowedIps: props.allowedIps,
      httpProxy: props.httpProxy,
      hostZoneName: props.hostZoneName,
      repository: props.repository,
      domainName: `${props.serviceName}.${props.hostZoneName}`,
      agent: bedrock.agent,
    });
  }
}
