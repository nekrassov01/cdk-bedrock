import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface FunctionConfig {
  BaseName: String;
  FunctionId: string;
  FunctionName: string;
  Path: string;
  SchemaFilePath: string;
  Description: string;
  Alias?: cdk.aws_lambda.Alias;
}

class funcionConfig {
  getConfig = (prefix: string, name: string, description: string) => {
    const kebabToPascalCase = (name: string) => {
      return name
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join("");
    };

    const kebabToSnakeCase = (name: string) => {
      return name.split("-").join("_");
    };

    const path = `lib/image/agent/src/agent/${kebabToSnakeCase(name)}`;

    return {
      BaseName: name,
      FunctionId: kebabToPascalCase(name),
      FunctionName: `${prefix}-${name}`,
      Path: path,
      Description: description,
      SchemaFilePath: `${path}/schema.yaml`,
    };
  };

  public Config(prefix: string): FunctionConfig[] {
    return [
      this.getConfig(prefix, "get-instances-count", "インスタンス数の取得"),
      this.getConfig(prefix, "get-instances-without-owner", "Ownerタグのないインスタンスの取得"),
      this.getConfig(prefix, "get-instances-with-open-permission", "0.0.0.0/0のが許可されたインスタンスの取得"),
    ];
  }
}

export interface FunctionProps {
  serviceName: string;
  httpProxy: string;
}

export class Function extends Construct {
  readonly functionConfig: FunctionConfig[];

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

    const cfg = new funcionConfig();
    this.functionConfig = [];
    cfg.Config(props.serviceName).map((obj) => {
      const fn = new cdk.aws_lambda.DockerImageFunction(this, `${obj.FunctionId}Function`, {
        functionName: obj.FunctionName,
        description: obj.FunctionName,
        code: cdk.aws_lambda.DockerImageCode.fromImageAsset(obj.Path, {
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
      obj.Alias = new cdk.aws_lambda.Alias(this, `${obj.FunctionId}Alias`, {
        aliasName: "live",
        version: fn.currentVersion,
      });
      this.functionConfig.push(obj);
    });
  }
}
