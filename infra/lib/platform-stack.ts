import {
  CfnOutput,
  Duration,
  IgnoreMode,
  RemovalPolicy,
  Stack,
  Tags,
  type StackProps,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cloudwatch as cloudwatch,
  custom_resources as customResources,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrAssets,
  aws_ecs as ecs,
  aws_ecs_patterns as ecsPatterns,
  aws_iam as iam,
  aws_logs as logs,
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
  webCorsOrigins: string[]
  applicationDesiredCount: number
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export class AttendancePlatformStack extends Stack {
  constructor(scope: Construct, id: string, props: AttendancePlatformStackProps) {
    super(scope, id, props)

    const isProduction = props.stage === 'prod'
    const removalPolicy = isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    const logRetention = isProduction
      ? logs.RetentionDays.THREE_MONTHS
      : logs.RetentionDays.ONE_WEEK
    const resourcePrefix = `attendance-${props.stage}`
    const normalCapacity = props.applicationDesiredCount > 0

    Tags.of(this).add('Environment', props.stage)
    Tags.of(this).add('Application', 'AttendancePlatform')
    Tags.of(this).add('ManagedBy', 'aws-cdk')

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
      vpcName: `${resourcePrefix}-vpc`,
      availabilityZones: [`${this.region}a`, `${this.region}b`],
      natGateways: isProduction ? 2 : 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'application', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: 'database', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    })

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      securityGroupName: `${resourcePrefix}-database`,
      description: 'Attendance PostgreSQL access from application tasks only',
      allowAllOutbound: false,
    })
    const databaseCredentials = new secretsmanager.Secret(this, 'DatabaseCredentials', {
      description: `${props.stage} attendance database credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'attendance_app' }),
        generateStringKey: 'password',
        excludePunctuation: true,
      },
      removalPolicy,
    })
    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      credentials: rds.Credentials.fromSecret(databaseCredentials),
      databaseName: 'attendance',
      instanceType: isProduction
        ? ec2.InstanceType.of(
            ec2.InstanceClass.BURSTABLE4_GRAVITON,
            ec2.InstanceSize.MEDIUM,
          )
        : ec2.InstanceType.of(
            ec2.InstanceClass.BURSTABLE4_GRAVITON,
            ec2.InstanceSize.MICRO,
          ),
      allocatedStorage: 20,
      maxAllocatedStorage: isProduction ? 500 : 100,
      storageType: rds.StorageType.GP3,
      multiAz: isProduction,
      storageEncrypted: true,
      deletionProtection: isProduction,
      deleteAutomatedBackups: !isProduction,
      backupRetention: Duration.days(isProduction ? 14 : 1),
      copyTagsToSnapshot: true,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      publiclyAccessible: false,
      removalPolicy,
    })

    const sharedIdentity = new CognitoOidcConnection(this, 'SharedIdentity', {
      domainPrefix: props.identityDomainPrefix,
      removalPolicy,
      requireMfa: isProduction,
      userPoolName: `${resourcePrefix}-users`,
    })

    const importBucket = new s3.Bucket(this, 'ImportBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        { expiration: Duration.days(isProduction ? 365 : 30) },
        {
          noncurrentVersionExpiration: Duration.days(isProduction ? 90 : 7),
        },
      ],
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
        {
          noncurrentVersionExpiration: Duration.days(isProduction ? 90 : 7),
        },
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
          noncurrentVersionExpiration: Duration.days(isProduction ? 365 : 30),
        },
      ],
      removalPolicy,
      autoDeleteObjects: !isProduction,
    })
    const webBucket = new s3.Bucket(this, 'WebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(isProduction ? 90 : 7),
        },
      ],
      removalPolicy,
      autoDeleteObjects: !isProduction,
    })

    const processingDeadLetterQueue = new sqs.Queue(
      this,
      'ProcessingDeadLetterQueue',
      {
        queueName: `${resourcePrefix}-processing-dlq.fifo`,
        fifo: true,
        encryption: sqs.QueueEncryption.KMS_MANAGED,
        retentionPeriod: Duration.days(14),
        enforceSSL: true,
        removalPolicy,
      },
    )
    const processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
      queueName: `${resourcePrefix}-processing.fifo`,
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
      removalPolicy,
    })

    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${resourcePrefix}-cluster`,
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    })

    const migrationSecurityGroup = new ec2.SecurityGroup(
      this,
      'MigrationSecurityGroup',
      {
        vpc,
        securityGroupName: `${resourcePrefix}-migration`,
        description: 'Network access for one-off Prisma migration tasks',
        allowAllOutbound: false,
      },
    )
    const endpointSecurityGroup = new ec2.SecurityGroup(
      this,
      'MigrationEndpointSecurityGroup',
      {
        vpc,
        securityGroupName: `${resourcePrefix}-migration-endpoints`,
        description: 'Private AWS service endpoints for migration tasks',
        allowAllOutbound: false,
      },
    )
    const migrationSubnet = vpc.isolatedSubnets[0]
    const endpointSubnets = { subnets: [migrationSubnet] }
    for (const [id, service] of [
      ['MigrationEcrApiEndpoint', ec2.InterfaceVpcEndpointAwsService.ECR],
      ['MigrationEcrDockerEndpoint', ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER],
      ['MigrationSecretsEndpoint', ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER],
      ['MigrationLogsEndpoint', ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS],
    ] as const) {
      const endpoint = vpc.addInterfaceEndpoint(id, {
        service,
        subnets: endpointSubnets,
        securityGroups: [endpointSecurityGroup],
        privateDnsEnabled: true,
      })
      endpoint.connections.allowDefaultPortFrom(migrationSecurityGroup)
    }
    vpc.addGatewayEndpoint('MigrationS3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnets: [migrationSubnet] }],
    })
    migrationSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS to private AWS endpoints; isolated subnet has no internet route',
    )
    migrationSecurityGroup.addEgressRule(
      databaseSecurityGroup,
      ec2.Port.tcp(5432),
      'PostgreSQL migration access',
    )

    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/attendance/${props.stage}/api`,
      retention: logRetention,
      removalPolicy,
    })
    const workerLogGroup = new logs.LogGroup(this, 'WorkerLogGroup', {
      logGroupName: `/attendance/${props.stage}/worker`,
      retention: logRetention,
      removalPolicy,
    })
    const migrationLogGroup = new logs.LogGroup(this, 'MigrationLogGroup', {
      logGroupName: `/attendance/${props.stage}/migration`,
      retention: logRetention,
      removalPolicy,
    })

    const apiImage = ecs.ContainerImage.fromAsset('..', {
      file: 'apps/api/Dockerfile',
      platform: ecrAssets.Platform.LINUX_AMD64,
      exclude: containerAssetExcludes,
      ignoreMode: IgnoreMode.DOCKER,
    })
    const apiEnvironment = {
      NODE_ENV: 'production',
      PORT: '3000',
      DATABASE_HOST: database.dbInstanceEndpointAddress,
      DATABASE_PORT: database.dbInstanceEndpointPort,
      DATABASE_NAME: 'attendance',
      IMPORT_BUCKET: importBucket.bucketName,
      EXPORT_BUCKET: exportBucket.bucketName,
      PROCESSING_QUEUE_URL: processingQueue.queueUrl,
      WEB_ORIGINS: unique([
        ...props.identityCallbackUrls.map(url => new URL(url).origin),
        ...props.webCorsOrigins.map(url => new URL(url).origin),
      ]).join(','),
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
    }
    const databaseSecrets = {
      DATABASE_USERNAME: ecs.Secret.fromSecretsManager(
        databaseCredentials,
        'username',
      ),
      DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(
        databaseCredentials,
        'password',
      ),
    }

    const apiTask = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      family: `${resourcePrefix}-api`,
      cpu: isProduction ? 1024 : 512,
      memoryLimitMiB: isProduction ? 2048 : 1024,
    })
    apiTask.addContainer('ApiContainer', {
      containerName: 'api',
      image: apiImage,
      environment: apiEnvironment,
      secrets: databaseSecrets,
      portMappings: [{ containerPort: 3000, name: 'http' }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'api',
        logGroup: apiLogGroup,
      }),
      healthCheck: {
        command: [
          'CMD-SHELL',
          "node -e \"fetch('http://localhost:3000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\"",
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.minutes(2),
      },
    })
    const api = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'Api',
      {
        cluster,
        serviceName: `${resourcePrefix}-api`,
        taskDefinition: apiTask,
        publicLoadBalancer: false,
        desiredCount: Math.max(1, props.applicationDesiredCount),
        circuitBreaker: { rollback: true },
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assignPublicIp: false,
        healthCheckGracePeriod: Duration.minutes(3),
      },
    )
    if (!normalCapacity) {
      const apiServiceResource = api.service.node.defaultChild as ecs.CfnService
      apiServiceResource.desiredCount = 0
    }
    api.loadBalancer.setAttribute(
      'deletion_protection.enabled',
      isProduction ? 'true' : 'false',
    )
    api.targetGroup.configureHealthCheck({
      path: '/api/v1/health',
      healthyHttpCodes: '200',
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    })
    database.connections.allowDefaultPortFrom(api.service)
    importBucket.grantRead(apiTask.taskRole, 'tenant/*/imports/*')
    importBucket.grantPut(apiTask.taskRole, 'tenant/*/imports/*')
    exportBucket.grantRead(apiTask.taskRole, 'tenant/*/payroll/*')
    samlMetadataBucket.grantReadWrite(apiTask.taskRole)
    apiTask.taskRole.addToPrincipalPolicy(
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
    apiTask.taskRole.addToPrincipalPolicy(
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

    if (normalCapacity) {
      const apiScaling = api.service.autoScaleTaskCount({
        minCapacity: 1,
        maxCapacity: isProduction ? 6 : 2,
      })
      apiScaling.scaleOnCpuUtilization('ApiCpuScaling', {
        targetUtilizationPercent: 60,
        scaleInCooldown: Duration.minutes(5),
        scaleOutCooldown: Duration.minutes(1),
      })
    }

    const workerTask = new ecs.FargateTaskDefinition(this, 'WorkerTask', {
      family: `${resourcePrefix}-worker`,
      cpu: isProduction ? 2048 : 1024,
      memoryLimitMiB: isProduction ? 4096 : 2048,
    })
    workerTask.addContainer('WorkerContainer', {
      containerName: 'worker',
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
        WORKER_VISIBILITY_SECONDS: '1200',
        ATTENDANCE_IMPORT_MAX_ROWS: '50000',
        ATTENDANCE_IMPORT_MAX_COLUMNS: '20',
        ATTENDANCE_IMPORT_MAX_CELL_BYTES: '1024',
        ATTENDANCE_XLSX_MAX_UNCOMPRESSED_BYTES: '209715200',
        ATTENDANCE_XLSX_MAX_COMPRESSION_RATIO: '100',
      },
      secrets: databaseSecrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'worker',
        logGroup: workerLogGroup,
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'node -e "process.kill(1, 0)"'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
    })
    const worker = new ecs.FargateService(this, 'WorkerService', {
      cluster,
      serviceName: `${resourcePrefix}-worker`,
      taskDefinition: workerTask,
      desiredCount: props.applicationDesiredCount,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    })
    database.connections.allowDefaultPortFrom(worker)
    importBucket.grantRead(workerTask.taskRole, 'tenant/*/imports/*')
    exportBucket.grantPut(workerTask.taskRole, 'tenant/*/payroll/*')
    processingQueue.grantConsumeMessages(workerTask.taskRole)
    processingQueue.grantSendMessages(workerTask.taskRole)

    if (normalCapacity) {
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
    }

    database.connections.allowDefaultPortFrom(migrationSecurityGroup)
    const migrationTask = new ecs.FargateTaskDefinition(this, 'MigrationTask', {
      family: `${resourcePrefix}-migration`,
      cpu: 512,
      memoryLimitMiB: 1024,
    })
    migrationTask.addContainer('MigrationContainer', {
      containerName: 'migration',
      image: apiImage,
      environment: {
        NODE_ENV: 'production',
        DATABASE_HOST: database.dbInstanceEndpointAddress,
        DATABASE_PORT: database.dbInstanceEndpointPort,
        DATABASE_NAME: 'attendance',
      },
      secrets: databaseSecrets,
      command: [
        '/bin/sh',
        '-c',
        'export DATABASE_URL="postgresql://$DATABASE_USERNAME:$DATABASE_PASSWORD@$DATABASE_HOST:$DATABASE_PORT/$DATABASE_NAME?schema=public"; exec node node_modules/prisma/build/index.js migrate deploy --schema=apps/api/prisma/schema.prisma',
      ],
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'migration',
        logGroup: migrationLogGroup,
      }),
    })

    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      comment: `${resourcePrefix} HTTPS entrypoint`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      additionalBehaviors: {
        'api/*': {
          origin: origins.VpcOrigin.withApplicationLoadBalancer(api.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            vpcOriginName: `${resourcePrefix}-api`,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          compress: true,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(1),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(1),
        },
      ],
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: isProduction
        ? cloudfront.PriceClass.PRICE_CLASS_ALL
        : cloudfront.PriceClass.PRICE_CLASS_100,
    })
    distribution.applyRemovalPolicy(removalPolicy)
    const applicationUrl = `https://${distribution.distributionDomainName}`

    apiTask.defaultContainer?.addEnvironment(
      'SCIM_PUBLIC_BASE_URL',
      `${applicationUrl}/api/v1/scim/v2`,
    )

    const webClient = sharedIdentity.addWebClient({
      callbackUrls: unique([...props.identityCallbackUrls, applicationUrl]),
      logoutUrls: unique([...props.identityLogoutUrls, applicationUrl]),
    })

    const importCorsOrigins = unique([
      ...props.identityCallbackUrls.map(url => new URL(url).origin),
      ...props.webCorsOrigins.map(url => new URL(url).origin),
      applicationUrl,
    ])
    const putImportCorsCall: customResources.AwsSdkCall = {
      service: 'S3',
      action: 'putBucketCors',
      parameters: {
        Bucket: importBucket.bucketName,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedMethods: ['PUT'],
              AllowedOrigins: importCorsOrigins,
              AllowedHeaders: [
                'content-type',
                'x-amz-checksum-sha256',
                'x-amz-meta-tenantid',
                'x-amz-meta-importjobid',
                'x-amz-meta-uploadid',
              ],
              ExposeHeaders: ['etag', 'x-amz-checksum-sha256'],
              MaxAgeSeconds: 300,
            },
          ],
        },
      },
      physicalResourceId: customResources.PhysicalResourceId.of(
        `${resourcePrefix}-import-cors`,
      ),
    }
    const importCors = new customResources.AwsCustomResource(
      this,
      'ImportBucketCors',
      {
        onCreate: putImportCorsCall,
        onUpdate: putImportCorsCall,
        policy: customResources.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [importBucket.bucketArn],
        }),
        installLatestAwsSdk: false,
      },
    )
    importCors.node.addDependency(distribution)

    new s3Deployment.BucketDeployment(this, 'WebDeployment', {
      sources: [s3Deployment.Source.asset('../dist')],
      destinationBucket: webBucket,
      prune: true,
      distribution,
      distributionPaths: ['/*'],
    })

    const apiCpu = api.service.metricCpuUtilization({
      period: Duration.minutes(5),
    })
    const apiMemory = api.service.metricMemoryUtilization({
      period: Duration.minutes(5),
    })
    const workerCpu = worker.metricCpuUtilization({
      period: Duration.minutes(5),
    })
    const workerMemory = worker.metricMemoryUtilization({
      period: Duration.minutes(5),
    })
    const loadBalancerDimensions = {
      LoadBalancer: api.loadBalancer.loadBalancerFullName,
      TargetGroup: api.targetGroup.targetGroupFullName,
    }
    const apiRequests = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'RequestCount',
      dimensionsMap: loadBalancerDimensions,
      statistic: 'Sum',
      period: Duration.minutes(5),
    })
    const apiTarget5xx = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'HTTPCode_Target_5XX_Count',
      dimensionsMap: loadBalancerDimensions,
      statistic: 'Sum',
      period: Duration.minutes(5),
    })
    const apiUnhealthyHosts = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'UnHealthyHostCount',
      dimensionsMap: loadBalancerDimensions,
      statistic: 'Maximum',
      period: Duration.minutes(1),
    })
    const queueDepth = processingQueue.metricApproximateNumberOfMessagesVisible({
      period: Duration.minutes(5),
    })
    const queueAge = processingQueue.metricApproximateAgeOfOldestMessage({
      period: Duration.minutes(5),
    })
    const dlqDepth =
      processingDeadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(1),
      })

    new cloudwatch.Alarm(this, 'ProcessingDlqAlarm', {
      alarmName: `${resourcePrefix}-processing-dlq-not-empty`,
      metric: dlqDepth,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    new cloudwatch.Alarm(this, 'ProcessingOldestMessageAlarm', {
      alarmName: `${resourcePrefix}-processing-message-too-old`,
      metric: queueAge,
      threshold: 1200,
      evaluationPeriods: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    new cloudwatch.Alarm(this, 'ApiTarget5xxAlarm', {
      alarmName: `${resourcePrefix}-api-target-5xx`,
      metric: apiTarget5xx,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    new cloudwatch.Alarm(this, 'ApiUnhealthyHostsAlarm', {
      alarmName: `${resourcePrefix}-api-unhealthy-hosts`,
      metric: apiUnhealthyHosts,
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    new cloudwatch.Alarm(this, 'WorkerCpuAlarm', {
      alarmName: `${resourcePrefix}-worker-high-cpu`,
      metric: workerCpu,
      threshold: 85,
      evaluationPeriods: 3,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    new cloudwatch.Alarm(this, 'DatabaseCpuAlarm', {
      alarmName: `${resourcePrefix}-database-high-cpu`,
      metric: database.metricCPUUtilization({
        period: Duration.minutes(5),
      }),
      threshold: 85,
      evaluationPeriods: 3,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    new cloudwatch.Alarm(this, 'DatabaseFreeStorageAlarm', {
      alarmName: `${resourcePrefix}-database-low-storage`,
      metric: database.metricFreeStorageSpace({
        period: Duration.minutes(5),
      }),
      threshold: 2 * 1024 * 1024 * 1024,
      evaluationPeriods: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    const dashboard = new cloudwatch.Dashboard(this, 'OperationsDashboard', {
      dashboardName: `${resourcePrefix}-operations`,
    })
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API traffic and errors',
        left: [apiRequests, apiTarget5xx, apiUnhealthyHosts],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'API and worker utilization',
        left: [apiCpu, apiMemory, workerCpu, workerMemory],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Processing queues',
        left: [queueDepth, queueAge, dlqDepth],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'PostgreSQL',
        left: [
          database.metricCPUUtilization(),
          database.metricDatabaseConnections(),
          database.metricFreeStorageSpace(),
        ],
        width: 12,
      }),
    )

    new CfnOutput(this, 'ApplicationUrl', { value: applicationUrl })
    new CfnOutput(this, 'ApiServiceName', {
      value: api.service.serviceName,
    })
    new CfnOutput(this, 'WorkerServiceName', {
      value: worker.serviceName,
    })
    new CfnOutput(this, 'MigrationTaskDefinitionArn', {
      value: migrationTask.taskDefinitionArn,
    })
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName })
    new CfnOutput(this, 'EcsClusterArn', { value: cluster.clusterArn })
    new CfnOutput(this, 'PrivateSubnetIds', {
      value: migrationSubnet.subnetId,
    })
    new CfnOutput(this, 'MigrationSecurityGroupId', {
      value: migrationSecurityGroup.securityGroupId,
    })
    new CfnOutput(this, 'MigrationContainerName', { value: 'migration' })
    new CfnOutput(this, 'MigrationLogGroupName', {
      value: migrationLogGroup.logGroupName,
    })
    new CfnOutput(this, 'WorkerLogGroupName', {
      value: workerLogGroup.logGroupName,
    })
    new CfnOutput(this, 'DatabaseEndpoint', {
      value: database.dbInstanceEndpointAddress,
    })
    new CfnOutput(this, 'ImportBucketName', { value: importBucket.bucketName })
    new CfnOutput(this, 'ExportBucketName', { value: exportBucket.bucketName })
    new CfnOutput(this, 'ProcessingQueueUrl', {
      value: processingQueue.queueUrl,
    })
    new CfnOutput(this, 'ProcessingDeadLetterQueueUrl', {
      value: processingDeadLetterQueue.queueUrl,
    })
    new CfnOutput(this, 'SamlMetadataBucketName', {
      value: samlMetadataBucket.bucketName,
    })
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
      value: webClient.userPoolClientId,
    })
    new CfnOutput(this, 'OperationsDashboardName', {
      value: dashboard.dashboardName,
    })
  }
}
