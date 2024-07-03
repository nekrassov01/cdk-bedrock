import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { bedrock } from "@cdklabs/generative-ai-cdk-constructs";
import * as fs from "fs";

export interface BedrockProps {
  serviceName: string;
  alias: cdk.aws_lambda.Alias;
}

export class Bedrock extends Construct {
  readonly agent: bedrock.Agent;

  constructor(scope: Construct, id: string, props: BedrockProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    const agentRole = new cdk.aws_iam.Role(this, "Role", {
      roleName: `${props.serviceName}-agent-role`,
      assumedBy: new cdk.aws_iam.ServicePrincipal("bedrock.amazonaws.com"),
      inlinePolicies: {
        AgentPolicy: new cdk.aws_iam.PolicyDocument({
          statements: [
            new cdk.aws_iam.PolicyStatement({
              effect: cdk.aws_iam.Effect.ALLOW,
              actions: ["bedrock:InvokeModel"],
              resources: [`arn:aws:bedrock:${stack.region}::foundation-model/*`],
            }),
          ],
        }),
      },
    });

    this.agent = new bedrock.Agent(this, "Agent", {
      name: `${props.serviceName}-agent`,
      aliasName: "v1",
      existingRole: agentRole,
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_SONNET_V1_0,
      instruction: fs.readFileSync("lib/instruction/instruction", "utf8"),
      shouldPrepareAgent: true,
      enableUserInput: true,
      idleSessionTTL: cdk.Duration.minutes(30),
    });

    const actionGroup = new bedrock.AgentActionGroup(this, "ActionGroup", {
      actionGroupName: `${props.serviceName}-actiongroup`,
      description: `${props.serviceName}-actiongroup`,
      actionGroupExecutor: {
        lambda: props.alias,
      },
      actionGroupState: "ENABLED",
      apiSchema: bedrock.ApiSchema.fromAsset("lib/schema/schema.yaml"),
      skipResourceInUseCheckOnDelete: false,
    });
    this.agent.addActionGroup(actionGroup);
  }
}
