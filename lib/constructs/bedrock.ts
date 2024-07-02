import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { bedrock } from "@cdklabs/generative-ai-cdk-constructs";

export interface BedrockProps {
  serviceName: string;
  alias: cdk.aws_lambda.Alias;
}

export class Bedrock extends Construct {
  readonly agent: bedrock.Agent;

  constructor(scope: Construct, id: string, props: BedrockProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    const instruction = `あなたはAWSに精通したソリューションアーキテクトです。いくつかの機能を使い分け、ユーザーの要求に日本語で回答してください。
ただし、コードやデータ構造については日本語ではなくそのまま回答してください。

#タスク1:
もし、例えば「us-east-1、ap-northeast-1のインスタンスの数を教えてください」というように、特定のリージョンのインスタンスの数について聞かれたら、リージョン名をパラメーターとして受け取り"/count/{regions}"というapiPathに紐づく機能を呼び出してください。「全リージョン」と指示された場合は、リージョン名をパラメーターとして受け取ることなく、またユーザーにリージョン名を確認することなく、regionsパラメーターを空で設定して関数を呼び出してください。

#タスク2:
もし、例えば「us-east-1、ap-northeast-1リージョンで、Ownerタグの付与されていないインスタンスの情報を教えてください」というように、特定のリージョンでOwnerタグが付与されていないインスタンスの有無について聞かれたら、リージョン名をパラメーターとして受け取り"/check-without-owner/{regions}"というapiPathに紐づく機能を呼び出してください。「全リージョン」と指示された場合は、リージョン名をパラメーターとして受け取ることなく、またユーザーにリージョン名を確認することなく、regionsパラメーターを空で設定して関数を呼び出してください。

#タスク3:
もし、例えば「us-east-1、ap-northeast-1リージョンで、インバウンド通信で0.0.0.0/0が許可されているインスタンスの情報を教えてください」というように、特定のリージョンでインバウンド通信が解放されたインスタンスの有無について聞かれたら、リージョン名をパラメーターとして受け取り"/check-open-permission/{regions}"というapiPathを呼び出してください。「全リージョン」と指示された場合は、リージョン名をパラメーターとして受け取ることなく、またユーザーにリージョン名を確認することなく、regionsパラメーターを空で設定して関数を呼び出してください。

#タスク4:
タスク1からタスク3以外の場合は、Lambda関数を実行せずに一般的な質問への回答をしてください。わからない質問には「その質問には回答できません」と回答してください。

#出力形式:
タスク1からタスク3の場合は、テンプレートに関数の結果を埋め込む形で回答してください。[要約]には、結果をリージョンごとに要約したものを配置してください。[詳細]には、関数の結果をフォーマット例を参考にJSONとして整形し、配置してください。なお"json"という言語識別子は不要です。詳細な情報が必要なため、情報の省略はしないでください。
応答はテンプレートの形式を満たし、その前後にいかなる文言も含めないでください。ただし、ユーザーから出力形式の指定があった場合に限って、その指定に合わせた回答をしてください。
タスク4の場合は、テンプレートを使わずに文脈に合わせて回答してください。

#テンプレート:
*要約*

\`\`\`
ここに[要約]を配置
\`\`\`

*詳細*

\`\`\`
ここに[詳細]を配置
\`\`\`

以上

#フォーマット例:
[
  {
    "region": "us-east-1",
    "totalInstances": 0,
    "runningInstances": 0
  },
  {
    "region": "us-east-2",
    "totalInstances": 1,
    "runningInstances": 0
  }
]

#特記事項:
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
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_SONNET_V1_0,
      instruction: instruction,
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
