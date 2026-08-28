import {
  CfnOutput,
  Duration,
  IgnoreMode,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_cloudfront as cloudfront,
  aws_cloudwatch as cloudwatch,
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
    const containerAssetExcludes = [
      '*',
      '!package.json',
      '!package-lock.json',
      '!apps/',
      'apps/*',
      '!apps/api/',
      '!apps/api/**',
      '!apps/contracts/',
      '!apps/contracts/**',
      '!apps/worker/',
      '!apps/worker/**',
      '!infra/',
      'infra/*',
      '!infra/package.json',
      'apps/api/dist',
      'apps/contracts/dist',
      'apps/worker/dist',
      '**/node_modules',
      '**/node_modules/**',
      '**/coverage',
      '**/coverage/**',
    ]
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
      encryption: s3.BucketEncryption.KMS_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT],
        allowedOrigins: props.identityCallbackUrls.map(url => new URL(url).origin),
        allowedHeaders: [
          'content-type',
          'x-amz-checksum-sha256',
          'x-amz-meta-tenantid',
          'x-amz-meta-importjobid',
          'x-amz-meta-uploadid',
        ],
        exposedHeaders: ['etag', 'x-amz-checksum-sha256'],
        maxAge: 300,
      }],
      removalPolicy,
      autoDeleteObjects: !isProduction,
    })
    const exportBucket = new s3.Bucket(this, 'ExportBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        { expiration: Duration.days(isProduction ? 365 : 30) },
        { noncurrentVersionExpiration: Duration.days(30) },
      ],
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

    const processingDeadLetterQueue = new sqs.Queue(this, 'ProcessingDeadLetterQueue', {
      fifo: true,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    })
    const processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
      fifo: true,
      contentBasedDeduplication: false,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      visibilityTimeout: Duration.minutes(20),
      retentionPeriod: Duration.days(14),
      receiveMessageWaitTime: Duration.seconds(20),
      deadLetterQueue: {
        maxReceiveCount: 5,
        queue: processingDeadLetterQueue,
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
        image: ecs.ContainerImage.fromAsset('..', {
          file: 'apps/api/Dockerfile',
          platform: ecrAssets.Platform.LINUX_AMD64,
          exclude: containerAssetExcludes,
          ignoreMode: IgnoreMode.DOCKER,
        }),
        containerPort: 3000,
        environment: {
          NODE_ENV: 'production',
          PORT: '3000',
          DATABASE_HOST: database.dbInstanceEndpointAddress,
          DATABASE_PORT: database.dbInstanceEndpointPort,
          DATABASE_NAME: 'attendance',
          IMPORT_BUCKET: importBucket.bucketName,
          EXPORT_BUCKET: exportBucket.bucketName,
          PROCESSING_QUEUE_URL: processingQueue.queueUrl,
          ATTENDANCE_IMPORT_MAX_BYTES: '26214400',
          ATTENDANCE_UPLOAD_EXPIRY_SECONDS: '300',
          PAYROLL_DOWNLOAD_EXPIRY_SECONDS: '300',
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
    importBucket.grantRead(api.taskDefinition.taskRole, 'tenant/*/imports/*')
    importBucket.grantPut(api.taskDefinition.taskRole, 'tenant/*/imports/*')
    exportBucket.grantRead(api.taskDefinition.taskRole, 'tenant/*/payroll/*')
    samlMetadataBucket.grantReadWrite(api.taskDefinition.taskRole)
    api.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminDeleteUserAttributes',
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

    const workerTask = new ecs.FargateTaskDefinition(this, 'WorkerTask', {
      cpu: isProduction ? 2048 : 1024,
      memoryLimitMiB: isProduction ? 4096 : 2048,
    })
    workerTask.addContainer('Worker', {
      image: ecs.ContainerImage.fromAsset('..', {
        file: 'apps/worker/Dockerfile',
        platform: ecrAssets.Platform.LINUX_AMD64,
        exclude: containerAssetExcludes,
        ignoreMode: IgnoreMode.DOCKER,
      }),
      environment: {
        NODE_ENV: 'production',
        DATABASE_HOST: database.dbInstanceEndpointAddress,
        DATABASE_PORT: database.dbInstanceEndpointPort,
        DATABASE_NAME: 'attendance',
        IMPORT_BUCKET: importBucket.bucketName,
        EXPORT_BUCKET: exportBucket.bucketName,
        PROCESSING_QUEUE_URL: processingQueue.queueUrl,
        WORKER_CONCURRENCY: isProduction ? '4' : '2',
        WORKER_VISIBILITY_SECONDS: '900',
        ATTENDANCE_IMPORT_MAX_ROWS: '50000',
        ATTENDANCE_IMPORT_MAX_COLUMNS: '20',
        ATTENDANCE_IMPORT_MAX_CELL_BYTES: '1024',
        ATTENDANCE_XLSX_MAX_UNCOMPRESSED_BYTES: '209715200',
        ATTENDANCE_XLSX_MAX_COMPRESSION_RATIO: '100',
      },
      secrets: {
        DATABASE_USERNAME: ecs.Secret.fromSecretsManager(databaseCredentials, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(databaseCredentials, 'password'),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'attendance-worker',
        logRetention: logs.RetentionDays.ONE_MONTH,
      }),
    })
    const worker = new ecs.FargateService(this, 'WorkerService', {
      cluster,
      taskDefinition: workerTask,
      desiredCount: 1,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    })
    database.connections.allowDefaultPortFrom(worker)
    importBucket.grantRead(workerTask.taskRole, 'tenant/*/imports/*')
    exportBucket.grantPut(workerTask.taskRole, 'tenant/*/payroll/*')
    processingQueue.grantConsumeMessages(workerTask.taskRole)
    processingQueue.grantSendMessages(workerTask.taskRole)

    const workerScaling = worker.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: isProduction ? 10 : 2,
    })
    workerScaling.scaleOnMetric('QueueDepthScaling', {
      metric: processingQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(1),
      }),
      scalingSteps: [
        { upper: 0, change: -1 },
        { lower: 5, change: +1 },
        { lower: 50, change: +3 },
      ],
      cooldown: Duration.minutes(2),
    })
    new cloudwatch.Alarm(this, 'ProcessingDlqAlarm', {
      metric: processingDeadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    })
    new cloudwatch.Alarm(this, 'ProcessingOldestMessageAlarm', {
      metric: processingQueue.metricApproximateAgeOfOldestMessage({
        period: Duration.minutes(5),
      }),
      threshold: 900,
      evaluationPeriods: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    })
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
    api.taskDefinition.defaultContainer?.addEnvironment(
      'SCIM_PUBLIC_BASE_URL',
      `https://${distribution.distributionDomainName}/api/v1/scim/v2`,
    )

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
    new CfnOutput(this, 'ExportBucketName', { value: exportBucket.bucketName })
    new CfnOutput(this, 'ProcessingQueueUrl', { value: processingQueue.queueUrl })
    new CfnOutput(this, 'ProcessingDeadLetterQueueUrl', {
      value: processingDeadLetterQueue.queueUrl,
    })
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
