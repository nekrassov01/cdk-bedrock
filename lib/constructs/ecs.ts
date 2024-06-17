import * as cdk from "aws-cdk-lib";
import * as ecrdeploy from "cdk-ecr-deployment";
import { Construct } from "constructs";
import { bedrock } from "@cdklabs/generative-ai-cdk-constructs";

export interface EcsProps {
  serviceName: string;
  allowedIps: string[];
  httpProxy: string;
  hostZoneName: string;
  repository: string;
  domainName: string;
  agent: bedrock.Agent;
}

export class Ecs extends Construct {
  constructor(scope: Construct, id: string, props: EcsProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    /**
     * Certificate
     */

    const hostedZone = cdk.aws_route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: props.hostZoneName,
    });
    const cert = new cdk.aws_certificatemanager.Certificate(this, "Certificate", {
      certificateName: `${props.serviceName}-cert`,
      domainName: props.domainName,
      subjectAlternativeNames: ["*." + props.domainName],
      validation: cdk.aws_certificatemanager.CertificateValidation.fromDns(hostedZone),
    });

    /**
     * VPC
     */

    const vpc = new cdk.aws_ec2.Vpc(this, "VPC", {
      ipAddresses: cdk.aws_ec2.IpAddresses.cidr("10.0.0.0/16"),
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "Private",
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });
    const endpointSecurityGroupName = `${props.serviceName}-endpoint-security-group`;
    const endpointSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, "EndpointSecurityGroup", {
      securityGroupName: endpointSecurityGroupName,
      description: endpointSecurityGroupName,
      vpc: vpc,
    });
    cdk.Tags.of(endpointSecurityGroup).add("Name", endpointSecurityGroupName);

    endpointSecurityGroup.addIngressRule(
      cdk.aws_ec2.Peer.ipv4(vpc.vpcCidrBlock),
      cdk.aws_ec2.Port.tcp(443),
      "allow VPC internal access"
    );
    vpc.addInterfaceEndpoint("ECREndpoint", {
      securityGroups: [endpointSecurityGroup],
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.ECR,
    });
    vpc.addInterfaceEndpoint("ECRDockerEndpoint", {
      securityGroups: [endpointSecurityGroup],
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
    });
    vpc.addInterfaceEndpoint("CloudWatchEndpoint", {
      securityGroups: [endpointSecurityGroup],
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    });
    vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
      securityGroups: [endpointSecurityGroup],
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });
    vpc.addInterfaceEndpoint("BedrockRuntimeEndpoint", {
      securityGroups: [endpointSecurityGroup],
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
    });
    vpc.addInterfaceEndpoint("BedrockAgentRuntimeEndpoint", {
      securityGroups: [endpointSecurityGroup],
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.BEDROCK_AGENT_RUNTIME,
    });
    vpc.addGatewayEndpoint("S3Endpoint", {
      service: cdk.aws_ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [
        {
          subnets: vpc.privateSubnets,
        },
      ],
    });
    const publicSubnets = vpc.selectSubnets({
      subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
    });
    const privateSubnets = vpc.selectSubnets({
      subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
    });

    /**
     * ECS
     */

    const contanerName = `${props.serviceName}-bedrock-app`;
    const containerPort = 8501;
    const tag = "latest";

    const repository = cdk.aws_ecr.Repository.fromRepositoryName(this, "Repository", props.repository);

    const image = new cdk.aws_ecr_assets.DockerImageAsset(this, "Image", {
      directory: "lib/image/app/src/app",
      buildArgs: {
        HTTP_PROXY: props.httpProxy,
      },
    });

    new ecrdeploy.ECRDeployment(this, "ImageDeployment", {
      src: new ecrdeploy.DockerImageName(image.imageUri),
      dest: new ecrdeploy.DockerImageName(repository.repositoryUriForTag(tag)),
    });

    const cluster = new cdk.aws_ecs.Cluster(this, "Cluster", {
      clusterName: `${props.serviceName}-cluster`,
      vpc: vpc,
      containerInsights: true,
    });

    const executionRole = new cdk.aws_iam.Role(this, "ExecutionRole", {
      roleName: `${props.serviceName}-execution-role`,
      assumedBy: new cdk.aws_iam.CompositePrincipal(new cdk.aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com")),
    });

    const taskRole = new cdk.aws_iam.Role(this, "TaskRole", {
      roleName: `${props.serviceName}-task-role`,
      assumedBy: new cdk.aws_iam.CompositePrincipal(new cdk.aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com")),
      inlinePolicies: {
        ECSTaskRoleAdditionalPolicy: new cdk.aws_iam.PolicyDocument({
          statements: [
            new cdk.aws_iam.PolicyStatement({
              effect: cdk.aws_iam.Effect.ALLOW,
              actions: ["bedrock:*"],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    const userSecret = new cdk.aws_secretsmanager.Secret(this, "UserSecret", {
      secretName: `${props.serviceName}-user-secret`,
      description: `${props.serviceName}-user-secret`,
      generateSecretString: {
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
        secretStringTemplate: JSON.stringify({ username: "admin" }),
      },
    });

    const cookieSecret = new cdk.aws_secretsmanager.Secret(this, "CookieSecret", {
      secretName: `${props.serviceName}-cookie-secret`,
      description: `${props.serviceName}-cookie-secret`,
      generateSecretString: {
        generateStringKey: "key",
        excludePunctuation: true,
        passwordLength: 256,
        secretStringTemplate: JSON.stringify({ name: "id" }),
      },
    });

    const taskDefinition = new cdk.aws_ecs.FargateTaskDefinition(this, "TaskDefinition", {
      family: `${props.serviceName}-task-definition`,
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: {
        operatingSystemFamily: cdk.aws_ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: cdk.aws_ecs.CpuArchitecture.ARM64,
      },
      executionRole: executionRole,
      taskRole: taskRole,
    });

    const logGroup = new cdk.aws_logs.LogGroup(this, "LogGroup", {
      logGroupName: `/aws/ecs/${props.serviceName}`,
      retention: cdk.aws_logs.RetentionDays.THREE_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    taskDefinition.addContainer("Container", {
      containerName: contanerName,
      image: cdk.aws_ecs.ContainerImage.fromEcrRepository(repository, tag),
      logging: cdk.aws_ecs.LogDrivers.awsLogs({
        logGroup: logGroup,
        streamPrefix: "logs",
      }),
      environment: {
        TARGET_REGION: stack.region,
        AGENT_ID: props.agent.agentId,
        AGENT_ALIAS_ID: props.agent.aliasId!,
        ACTION_LABELS: JSON.stringify([
          "インスタンス数の取得",
          "Ownerタグのないインスタンスの取得",
          "0.0.0.0/0が許可されたインスタンスの取得",
        ]),
      },
      secrets: {
        USERNAME: cdk.aws_ecs.Secret.fromSecretsManager(userSecret, "username"),
        PASSWORD: cdk.aws_ecs.Secret.fromSecretsManager(userSecret, "password"),
        COOKIE_NAME: cdk.aws_ecs.Secret.fromSecretsManager(cookieSecret, "name"),
        COOKIE_KEY: cdk.aws_ecs.Secret.fromSecretsManager(cookieSecret, "key"),
      },
      portMappings: [
        {
          containerPort: containerPort,
          protocol: cdk.aws_ecs.Protocol.TCP,
        },
      ],
    });

    const serviceSecurityGroupName = `${props.serviceName}-service-security-group`;
    const serviceSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, "ServiceSecurityGroup", {
      securityGroupName: serviceSecurityGroupName,
      description: serviceSecurityGroupName,
      vpc: vpc,
      allowAllOutbound: true,
    });
    cdk.Tags.of(serviceSecurityGroup).add("Name", serviceSecurityGroupName);

    const service = new cdk.aws_ecs.FargateService(this, "Service", {
      serviceName: `${props.serviceName}-service`,
      cluster: cluster,
      vpcSubnets: privateSubnets,
      securityGroups: [serviceSecurityGroup],
      taskDefinition: taskDefinition,
      desiredCount: 1,
      healthCheckGracePeriod: cdk.Duration.minutes(5),
      enableECSManagedTags: true,
      enableExecuteCommand: true,
    });

    const albSecurityGroupName = `${props.serviceName}-alb-security-group`;
    const albSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, "ALBSecurityGroup", {
      securityGroupName: albSecurityGroupName,
      description: albSecurityGroupName,
      vpc: vpc,
      allowAllOutbound: false,
    });
    cdk.Tags.of(albSecurityGroup).add("Name", albSecurityGroupName);
    props.allowedIps.map((ip) => {
      albSecurityGroup.addIngressRule(
        cdk.aws_ec2.Peer.ipv4(ip),
        cdk.aws_ec2.Port.tcp(443),
        "Allow from company global ips"
      );
    });

    const alb = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(this, "ALB", {
      loadBalancerName: `${props.serviceName}-alb`,
      vpc: vpc,
      vpcSubnets: publicSubnets,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    const listener = alb.addListener("Listener", {
      protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTPS,
      certificates: [
        {
          certificateArn: cert.certificateArn,
        },
      ],
      open: false,
    });

    listener.addTargets("Target", {
      targetGroupName: `${props.serviceName}-tg`,
      targets: [service],
      healthCheck: {
        healthyThresholdCount: 3,
        interval: cdk.Duration.seconds(60),
        timeout: cdk.Duration.seconds(30),
      },
      slowStart: cdk.Duration.seconds(60),
      port: containerPort,
      protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
    });

    const aRecord = new cdk.aws_route53.ARecord(this, "ARecord", {
      recordName: props.domainName,
      target: cdk.aws_route53.RecordTarget.fromAlias(new cdk.aws_route53_targets.LoadBalancerTarget(alb)),
      zone: hostedZone,
    });
    aRecord.node.addDependency(alb);
  }
}
