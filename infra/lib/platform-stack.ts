import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrAssets,
  aws_ecs as ecs,
  aws_ecs_patterns as ecsPatterns,
  aws_logs as logs,
  aws_iam as iam,
  aws_rds as rds,
  aws_s3 as s3,
  aws_s3_deployment as s3Deployment,
  aws_secretsmanager as secretsmanager,
  aws_sqs as sqs,
} from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { CognitoOidcConnection } from './cognito-oidc-connection.js'

interface AttendancePlatformStackProps extends StackProps {
  stage: string
  identityCallbackUrls: string[]
  identityLogoutUrls: string[]
  identityDomainPrefix: string
  identityAdminPoolArns: string[]
}

export class AttendancePlatformStack extends Stack {
  constructor(scope: Construct, id: string, props: AttendancePlatformStackProps) {
    super(scope, id, props)

    const isProduction = props.stage === 'prod'
    const removalPolicy = isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: isProduction ? 2 : 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'application', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: 'database', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    })

    const databaseCredentials = new secretsmanager.Secret(this, 'DatabaseCredentials', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'attendance_app' }),
        generateStringKey: 'password',
        excludePunctuation: true,
      },
    })

    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      credentials: rds.Credentials.fromSecret(databaseCredentials),
      databaseName: 'attendance',
      instanceType: isProduction
        ? ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MEDIUM)
        : ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      maxAllocatedStorage: 200,
      multiAz: isProduction,
      storageEncrypted: true,
      deletionProtection: isProduction,
      backupRetention: Duration.days(isProduction ? 14 : 1),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      removalPolicy,
    })

    const sharedIdentity = new CognitoOidcConnection(this, 'SharedIdentity', {
      domainPrefix: props.identityDomainPrefix,
      callbackUrls: props.identityCallbackUrls,
      logoutUrls: props.identityLogoutUrls,
      removalPolicy,
      requireMfa: isProduction,
    })

    const importBucket = new s3.Bucket(this, 'ImportBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: isProduction,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy,
      autoDeleteObjects: !isProduction,
    })
    const samlMetadataBucket = new s3.Bucket(this, 'SamlMetadataBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(90),
        },
      ],
      removalPolicy,
      autoDeleteObjects: !isProduction,
    })
    const webBucket = new s3.Bucket(this, 'WebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !isProduction,
    })

    const processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
      visibilityTimeout: Duration.minutes(15),
      retentionPeriod: Duration.days(14),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: new sqs.Queue(this, 'ProcessingDeadLetterQueue', {
          retentionPeriod: Duration.days(14),
        }),
      },
      enforceSSL: true,
    })

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    })
    const api = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Api', {
      cluster,
      publicLoadBalancer: true,
      desiredCount: isProduction ? 2 : 1,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      cpu: isProduction ? 1024 : 512,
      memoryLimitMiB: isProduction ? 2048 : 1024,
      taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('../apps/api', {
          platform: ecrAssets.Platform.LINUX_AMD64,
        }),
        containerPort: 3000,
        environment: {
          NODE_ENV: 'production',
          PORT: '3000',
          DATABASE_HOST: database.dbInstanceEndpointAddress,
          DATABASE_PORT: database.dbInstanceEndpointPort,
          DATABASE_NAME: 'attendance',
          IMPORT_BUCKET: importBucket.bucketName,
          PROCESSING_QUEUE_URL: processingQueue.queueUrl,
          SAML_METADATA_BUCKET: samlMetadataBucket.bucketName,
          SAML_SHARED_POOL_IDS: sharedIdentity.userPool.userPoolId,
          IDENTITY_ADMIN_POOL_ARNS: [
            sharedIdentity.userPool.userPoolArn,
            ...props.identityAdminPoolArns,
          ].join(','),
          SAML_ALLOW_INSECURE_LOCALHOST: 'false',
          API_JSON_BODY_LIMIT: '256kb',
          SCIM_RATE_LIMIT_PER_MINUTE: '120',
        },
        secrets: {
          DATABASE_USERNAME: ecs.Secret.fromSecretsManager(databaseCredentials, 'username'),
          DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(databaseCredentials, 'password'),
        },
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'api',
          logRetention: logs.RetentionDays.ONE_MONTH,
        }),
      },
      healthCheckGracePeriod: Duration.minutes(2),
    })
    api.targetGroup.configureHealthCheck({ path: '/api/v1/health' })
    database.connections.allowDefaultPortFrom(api.service)
    importBucket.grantReadWrite(api.taskDefinition.taskRole)
    samlMetadataBucket.grantReadWrite(api.taskDefinition.taskRole)
    processingQueue.grantSendMessages(api.taskDefinition.taskRole)
    api.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminResetUserPassword',
        ],
        resources: [
          sharedIdentity.userPool.userPoolArn,
          ...props.identityAdminPoolArns,
        ],
      }),
    )
    api.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:CreateIdentityProvider',
          'cognito-idp:UpdateIdentityProvider',
          'cognito-idp:DescribeIdentityProvider',
          'cognito-idp:DeleteIdentityProvider',
          'cognito-idp:DescribeUserPoolClient',
          'cognito-idp:UpdateUserPoolClient',
        ],
        resources: [
          sharedIdentity.userPool.userPoolArn,
          ...props.identityAdminPoolArns,
        ],
      }),
    )

    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        'api/*': {
          origin: new origins.LoadBalancerV2Origin(api.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    })

    new s3Deployment.BucketDeployment(this, 'WebDeployment', {
      sources: [s3Deployment.Source.asset('../dist')],
      destinationBucket: webBucket,
      prune: true,
      distribution,
      distributionPaths: ['/*'],
    })

    new CfnOutput(this, 'ApplicationUrl', { value: `https://${distribution.distributionDomainName}` })
    new CfnOutput(this, 'DatabaseEndpoint', { value: database.dbInstanceEndpointAddress })
    new CfnOutput(this, 'ImportBucketName', { value: importBucket.bucketName })
    new CfnOutput(this, 'SamlMetadataBucketName', { value: samlMetadataBucket.bucketName })
    new CfnOutput(this, 'WebBucketName', { value: webBucket.bucketName })
    new CfnOutput(this, 'SharedIdentityIssuer', {
      value: sharedIdentity.issuer(this.region),
    })
    new CfnOutput(this, 'SharedIdentityHostedUiBaseUrl', {
      value: sharedIdentity.hostedUiBaseUrl(),
    })
    new CfnOutput(this, 'SharedIdentityUserPoolId', {
      value: sharedIdentity.userPool.userPoolId,
    })
    new CfnOutput(this, 'SharedIdentityClientId', {
      value: sharedIdentity.userPoolClient.userPoolClientId,
    })
  }
}
