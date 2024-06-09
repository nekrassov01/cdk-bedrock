import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { KnowledgeBase } from "./constructs/kb";
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

    const domainName = `${props.serviceName}.${props.hostZoneName}`;

    const kb = new KnowledgeBase(this, "KnowledgeBase", {
      serviceName: props.serviceName,
    });

    new Ecs(this, "ECS", {
      serviceName: props.serviceName,
      allowedIps: props.allowedIps,
      httpProxy: props.httpProxy,
      hostZoneName: props.hostZoneName,
      repository: props.repository,
      domainName: domainName,
      knowledgebase: kb.knowledgebase,
    });
  }
}
