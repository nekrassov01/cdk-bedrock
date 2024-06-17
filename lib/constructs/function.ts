import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface FunctionProps {
  serviceName: string;
  httpProxy: string;
}

export class Function extends Construct {
  readonly alias: cdk.aws_lambda.Alias;

  constructor(scope: Construct, id: string, props: FunctionProps) {
    super(scope, id);

    const functionRole = new cdk.aws_iam.Role(this, "Role", {
      roleName: `${props.serviceName}-function-role`,
      assumedBy: new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        FunctionPolicy: new cdk.aws_iam.PolicyDocument({
          statements: [
            new cdk.aws_iam.PolicyStatement({
              effect: cdk.aws_iam.Effect.ALLOW,
              actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
              resources: ["arn:aws:logs:*:*:*"],
            }),
            new cdk.aws_iam.PolicyStatement({
              effect: cdk.aws_iam.Effect.ALLOW,
              actions: ["ec2:Describe*"],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    const fn = new cdk.aws_lambda.DockerImageFunction(this, "Function", {
      functionName: `${props.serviceName}-agent-action`,
      description: `${props.serviceName}-agent-action`,
      code: cdk.aws_lambda.DockerImageCode.fromImageAsset("lib/image/agent/src/agent", {
        buildArgs: {
          HTTP_PROXY: props.httpProxy,
        },
      }),
      architecture: cdk.aws_lambda.Architecture.ARM_64,
      role: functionRole,
      logRetention: cdk.aws_logs.RetentionDays.THREE_DAYS,
      currentVersionOptions: {
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
      timeout: cdk.Duration.minutes(5),
    });
    this.alias = new cdk.aws_lambda.Alias(this, "Alias", {
      aliasName: "live",
      version: fn.currentVersion,
    });
  }
}
