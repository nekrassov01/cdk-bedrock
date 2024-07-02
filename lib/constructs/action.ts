import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface ActionProps {
  serviceName: string;
  httpProxy: string;
}

export class Action extends Construct {
  readonly alias: cdk.aws_lambda.Alias;

  constructor(scope: Construct, id: string, props: ActionProps) {
    super(scope, id);

    const role = new cdk.aws_iam.Role(this, "Role", {
      roleName: `${props.serviceName}-action-role`,
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
      functionName: `${props.serviceName}-action`,
      description: `${props.serviceName}-action`,
      code: cdk.aws_lambda.DockerImageCode.fromImageAsset("lib/image/agent-go", {
        buildArgs: {
          HTTP_PROXY: props.httpProxy,
          HTTPS_PROXY: props.httpProxy,
        },
      }),
      architecture: cdk.aws_lambda.Architecture.ARM_64,
      role: role,
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
