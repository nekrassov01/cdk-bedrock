import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Bedrock } from "./constructs/bedrock";
import { Action } from "./constructs/action";
import { Ecs } from "./constructs/ecs";
import { SlackBot } from "./constructs/slackbot";

export interface BedrockStackProps extends cdk.StackProps {
  serviceName: string;
  allowedIps: string[];
  httpProxy: string;
  hostZoneName: string;
  repository: string;
  slackOAuthToken: string;
  slackSigningSecret: string;
  hasUI: boolean;
}

export class BedrockStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BedrockStackProps) {
    super(scope, id, props);

    const action = new Action(this, "Action", {
      serviceName: props.serviceName,
      httpProxy: props.httpProxy,
    });

    const bedrock = new Bedrock(this, "Bedrock", {
      serviceName: props.serviceName,
      alias: action.alias,
    });

    if (props.hasUI) {
      new Ecs(this, "ECS", {
        serviceName: props.serviceName,
        allowedIps: props.allowedIps,
        httpProxy: props.httpProxy,
        hostZoneName: props.hostZoneName,
        repository: props.repository,
        domainName: `${props.serviceName}.${props.hostZoneName}`,
        agent: bedrock.agent,
      });
    } else {
      new SlackBot(this, "SlackBot", {
        serviceName: props.serviceName,
        httpProxy: props.httpProxy,
        hostZoneName: props.hostZoneName,
        domainName: `${props.serviceName}.${props.hostZoneName}`,
        slackOAuthToken: props.slackOAuthToken,
        slackSigningSecret: props.slackSigningSecret,
        agent: bedrock.agent,
      });
    }
  }
}
