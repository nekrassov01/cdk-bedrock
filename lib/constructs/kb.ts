import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { bedrock } from "@cdklabs/generative-ai-cdk-constructs";

export interface KnowledgeBaseProps {
  serviceName: string;
}

export class KnowledgeBase extends Construct {
  readonly knowledgebase: bedrock.KnowledgeBase;

  constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
    super(scope, id);

    const bucket = new cdk.aws_s3.Bucket(this, "Bucket", {
      bucketName: `${props.serviceName}-knowledgebase-document`,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      objectOwnership: cdk.aws_s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
    });

    new cdk.aws_s3_deployment.BucketDeployment(this, "BucketDeployment", {
      sources: [cdk.aws_s3_deployment.Source.asset("lib/content/doc/data.zip")],
      destinationBucket: bucket,
      logRetention: cdk.aws_logs.RetentionDays.THREE_DAYS,
    });

    this.knowledgebase = new bedrock.KnowledgeBase(this, "KnowledgeBase", {
      name: `${props.serviceName}-knowledgebase`,
      description: `${props.serviceName}-knowledgebase`,
      embeddingsModel: bedrock.BedrockFoundationModel.COHERE_EMBED_MULTILINGUAL_V3,
      instruction:
        "YAMAHAというメーカーが開発したRTX1200というVPNルーターに関する質問に回答してください。参考ドキュメントにはユーザーガイド、コマンドリファレンス、設定例集が含まれています。",
    });

    new bedrock.S3DataSource(this, "DataSource", {
      bucket: bucket,
      knowledgeBase: this.knowledgebase,
      dataSourceName: `${props.serviceName}-knowledgebase-datasource`,
      chunkingStrategy: bedrock.ChunkingStrategy.FIXED_SIZE,
      maxTokens: 512,
      overlapPercentage: 20,
    });
  }
}
