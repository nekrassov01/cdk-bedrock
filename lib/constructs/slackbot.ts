import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { bedrock } from "@cdklabs/generative-ai-cdk-constructs";

export interface SlackBotProps {
  serviceName: string;
  httpProxy: string;
  hostZoneName: string;
  domainName: string;
  slackOAuthToken: string;
  slackSigningSecret: string;
  agent: bedrock.Agent;
}

export class SlackBot extends Construct {
  constructor(scope: Construct, id: string, props: SlackBotProps) {
    super(scope, id);

    const queue = new cdk.aws_sqs.Queue(this, "Queue", {
      queueName: `${props.serviceName}-slackbot-queue`,
      encryption: cdk.aws_sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retentionPeriod: cdk.Duration.days(7),
      visibilityTimeout: cdk.Duration.minutes(5),
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    const enqueueRole = new cdk.aws_iam.Role(this, "EnqueueRole", {
      roleName: `${props.serviceName}-slackbot-enqueue-role`,
      assumedBy: new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        SlackBotEnqueueRoleAdditionalPolicy: new cdk.aws_iam.PolicyDocument({
          statements: [
            new cdk.aws_iam.PolicyStatement({
              effect: cdk.aws_iam.Effect.ALLOW,
              actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
              resources: ["arn:aws:logs:*:*:*"],
            }),
          ],
        }),
      },
    });

    const enqueueFn = new cdk.aws_lambda.DockerImageFunction(this, "EnqueueFunction", {
      functionName: `${props.serviceName}-slackbot-enqueue`,
      description: `${props.serviceName}-slackbot-enqueue`,
      code: cdk.aws_lambda.DockerImageCode.fromImageAsset("lib/image/slackbot", {
        buildArgs: {
          NAME: "enqueue",
          HTTP_PROXY: props.httpProxy,
          HTTPS_PROXY: props.httpProxy,
        },
      }),
      architecture: cdk.aws_lambda.Architecture.ARM_64,
      role: enqueueRole,
      logRetention: cdk.aws_logs.RetentionDays.THREE_DAYS,
      currentVersionOptions: {
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
      timeout: cdk.Duration.seconds(3),
      environment: {
        QUEUE_URL: queue.queueUrl,
        SLACK_OAUTH_TOKEN: props.slackOAuthToken,
        SLACK_SIGNING_SECRET: props.slackSigningSecret,
      },
    });

    const enqueueAlias = new cdk.aws_lambda.Alias(this, "EnqueueAlias", {
      aliasName: "live",
      version: enqueueFn.currentVersion,
    });
    queue.grantSendMessages(enqueueAlias);

    const dequeueRole = new cdk.aws_iam.Role(this, "DequeueRole", {
      roleName: `${props.serviceName}-slackbot-dequeue-role`,
      assumedBy: new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        SlackBotDequeueRoleAdditionalPolicy: new cdk.aws_iam.PolicyDocument({
          statements: [
            new cdk.aws_iam.PolicyStatement({
              effect: cdk.aws_iam.Effect.ALLOW,
              actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
              resources: ["arn:aws:logs:*:*:*"],
            }),
            new cdk.aws_iam.PolicyStatement({
              effect: cdk.aws_iam.Effect.ALLOW,
              actions: ["bedrock:*"],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    const dequeueFn = new cdk.aws_lambda.DockerImageFunction(this, "DequeueFunction", {
      functionName: `${props.serviceName}-slackbot-dequeue`,
      description: `${props.serviceName}-slackbot-dequeue`,
      code: cdk.aws_lambda.DockerImageCode.fromImageAsset("lib/image/slackbot", {
        buildArgs: {
          NAME: "dequeue",
          HTTP_PROXY: props.httpProxy,
          HTTPS_PROXY: props.httpProxy,
        },
      }),
      architecture: cdk.aws_lambda.Architecture.ARM_64,
      role: dequeueRole,
      logRetention: cdk.aws_logs.RetentionDays.THREE_DAYS,
      currentVersionOptions: {
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
      timeout: cdk.Duration.minutes(5),
      environment: {
        AGENT_ID: props.agent.agentId,
        AGENT_ALIAS_ID: props.agent.aliasId!,
        QUEUE_URL: queue.queueUrl,
        SLACK_OAUTH_TOKEN: props.slackOAuthToken,
        SLACK_SIGNING_SECRET: props.slackSigningSecret,
      },
    });

    const dequeueAlias = new cdk.aws_lambda.Alias(this, "DequeueAlias", {
      aliasName: "live",
      version: dequeueFn.currentVersion,
    });
    queue.grantConsumeMessages(dequeueAlias);

    dequeueAlias.addEventSource(
      new cdk.aws_lambda_event_sources.SqsEventSource(queue, {
        batchSize: 1,
        maxConcurrency: 2,
      })
    );

    const hostedZone = cdk.aws_route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: props.hostZoneName,
    });

    const certificate = new cdk.aws_certificatemanager.Certificate(this, "Certificate", {
      certificateName: `${props.serviceName}-cert`,
      domainName: props.domainName,
      subjectAlternativeNames: ["*." + props.domainName],
      validation: cdk.aws_certificatemanager.CertificateValidation.fromDns(hostedZone),
    });

    const domainName = new cdk.aws_apigatewayv2.DomainName(this, "Domain", {
      domainName: props.domainName,
      certificate: certificate,
    });

    const apiName = `${props.serviceName}-slackbot-gateway`;
    const api = new cdk.aws_apigatewayv2.HttpApi(this, "API", {
      apiName: apiName,
      description: apiName,
      disableExecuteApiEndpoint: true,
      defaultDomainMapping: {
        domainName: domainName,
      },
    });

    api.addRoutes({
      methods: [cdk.aws_apigatewayv2.HttpMethod.ANY],
      path: "/slack/callback",
      integration: new cdk.aws_apigatewayv2_integrations.HttpLambdaIntegration("Callback", enqueueAlias),
    });

    const logGroup = new cdk.aws_logs.LogGroup(this, "LogGroup", {
      logGroupName: `/aws/apigateway/${apiName}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: cdk.aws_logs.RetentionDays.THREE_DAYS,
    });

    const defaultStage = api.defaultStage?.node.defaultChild as cdk.aws_apigatewayv2.CfnStage;
    defaultStage.accessLogSettings = {
      destinationArn: logGroup.logGroupArn,
      format: JSON.stringify({
        requestId: "$context.requestId",
        ip: "$context.identity.sourceIp",
        caller: "$context.identity.caller",
        user: "$context.identity.user",
        requestTime: "$context.requestTime",
        httpMethod: "$context.httpMethod",
        resourcePath: "$context.resourcePath",
        status: "$context.status",
        protocol: "$context.protocol",
        responseLength: "$context.responseLength",
      }),
    };

    const aRecord = new cdk.aws_route53.ARecord(this, "ARecord", {
      recordName: props.domainName,
      target: cdk.aws_route53.RecordTarget.fromAlias(
        new cdk.aws_route53_targets.ApiGatewayv2DomainProperties(
          domainName.regionalDomainName,
          domainName.regionalHostedZoneId
        )
      ),
      zone: hostedZone,
    });
    aRecord.node.addDependency(api);
  }
}
