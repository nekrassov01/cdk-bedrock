import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { bedrock } from "@cdklabs/generative-ai-cdk-constructs";
import { FunctionConfig } from "./function";

export interface BedrockProps {
  serviceName: string;
  functionConfig: FunctionConfig[];
}

export class Bedrock extends Construct {
  readonly agent: bedrock.Agent;

  constructor(scope: Construct, id: string, props: BedrockProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    const instruction = `あなたはAWSに精通したソリューションアーキテクトです。いくつかの関数を使い分け、ユーザーの要求に日本語で回答してください。
ただし、コードやデータ構造については日本語ではなくそのまま回答してください。

タスク1:
もし、例えば「インスタンスの数を教えてください」というように、インスタンスの数について聞かれたら、${props.functionConfig[0].FunctionName}というLambda関数を実行してください。

タスク2:
もし、例えば「Ownerタグの付与されていないインスタンスの情報を教えてください」というように、Ownerタグが付与されていないインスタンスの有無について聞かれたら、${props.functionConfig[1].FunctionName}というLambda関数を実行してください。

タスク3:
もし、例えば「インバウンド通信で0.0.0.0/0が許可されているインスタンスの情報を教えてください」というように、インバウンド通信が解放されたインスタンスの有無について聞かれたら、${props.functionConfig[2].FunctionName}というLambda関数を実行してください。

タスク4:
タスク1、タスク2、タスク3以外の場合は、Lambda関数を実行せずに一般的な質問への回答をしてください。わからない質問には「その質問には回答できません」と回答してください。

出力形式:
出力形式の指示が特にない場合は、項目を網羅して整形し、リスト形式で結果を返してください。
例えば「マークダウンの表で回答してください。」や「結果のJSONをそのまま返してください。」など、ユーザーから出力形式が指定された場合に限って、指示に合わせた回答をしてください。

特記事項:
関数の実行結果に関する質問をユーザーから追加で受けた場合は、再度同様の関数を実行することなく、前回の結果を参照し、文脈にあった回答をしてください。
`;

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
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_HAIKU_V1_0,
      instruction: instruction,
      shouldPrepareAgent: true,
      enableUserInput: true,
      idleSessionTTL: cdk.Duration.minutes(15),
    });

    props.functionConfig.map((obj) => {
      const actionGroup = new bedrock.AgentActionGroup(this, `${obj.FunctionId}ActionGroup`, {
        actionGroupName: `${obj.FunctionName}-actiongroup`,
        description: `${obj.FunctionName}-actiongroup`,
        actionGroupExecutor: {
          lambda: obj.Alias,
        },
        actionGroupState: "ENABLED",
        apiSchema: bedrock.ApiSchema.fromAsset(obj.SchemaFilePath),
        skipResourceInUseCheckOnDelete: false,
      });
      this.agent.addActionGroup(actionGroup);

      obj.Alias?.addPermission(`${obj.FunctionId}Permission`, {
        principal: new cdk.aws_iam.ServicePrincipal("bedrock.amazonaws.com"),
        action: "lambda:InvokeFunction",
        sourceArn: this.agent.agentArn,
      });
    });
  }
}
