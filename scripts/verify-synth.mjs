import { readFileSync } from 'node:fs'
import { parseArguments, requireValue } from './lib/commands.mjs'

const args = parseArguments(process.argv.slice(2))
const templatePath = requireValue(args, 'template')
const template = JSON.parse(readFileSync(templatePath, 'utf8'))
const resources = Object.values(template.Resources ?? {})
const ofType = type => resources.filter(resource => resource.Type === type)
const assert = (condition, message) => {
  if (!condition) throw new Error(`Infrastructure assertion failed: ${message}`)
}

const buckets = ofType('AWS::S3::Bucket')
assert(buckets.length >= 4, 'expected import, export, SAML metadata, and web buckets')
for (const bucket of buckets) {
  const properties = bucket.Properties ?? {}
  const block = properties.PublicAccessBlockConfiguration ?? {}
  assert(
    block.BlockPublicAcls && block.BlockPublicPolicy &&
      block.IgnorePublicAcls && block.RestrictPublicBuckets,
    'every bucket must block all public access',
  )
  assert(properties.BucketEncryption, 'every bucket must have default encryption')
}
const versionedBuckets = buckets.filter(
  bucket => bucket.Properties?.VersioningConfiguration?.Status === 'Enabled',
)
assert(versionedBuckets.length >= 3, 'data buckets must enable versioning')

const queues = ofType('AWS::SQS::Queue')
assert(queues.length === 2, 'expected one processing queue and one DLQ')
const sourceQueue = queues.find(queue => queue.Properties?.RedrivePolicy)
assert(sourceQueue?.Properties?.FifoQueue === true, 'processing queue must be FIFO')
assert(sourceQueue?.Properties?.VisibilityTimeout === 1200, 'processing visibility must be 20 minutes')
assert(sourceQueue?.Properties?.RedrivePolicy?.maxReceiveCount === 5, 'redrive must occur after five receives')
assert(queues.every(queue => queue.Properties?.KmsMasterKeyId), 'queues must use KMS encryption')

const databases = ofType('AWS::RDS::DBInstance')
assert(databases.length === 1, 'expected one RDS instance')
assert(databases[0].Properties?.PubliclyAccessible === false, 'RDS must not be public')
assert(databases[0].Properties?.StorageEncrypted === true, 'RDS storage must be encrypted')

const distributions = ofType('AWS::CloudFront::Distribution')
assert(distributions.length === 1, 'expected one CloudFront distribution')
const distribution = distributions[0].Properties?.DistributionConfig
assert(
  distribution?.DefaultCacheBehavior?.ViewerProtocolPolicy === 'redirect-to-https',
  'web traffic must redirect to HTTPS',
)

const services = ofType('AWS::ECS::Service')
assert(services.length === 2, 'expected API and worker ECS services')
assert(services.every(service => service.Properties?.DesiredCount === 0), 'migration-first synth must disable traffic')
const loadBalancers = ofType('AWS::ElasticLoadBalancingV2::LoadBalancer')
assert(
  loadBalancers.length === 1 && loadBalancers[0].Properties?.Scheme === 'internal',
  'API load balancer must be internal and reachable only through CloudFront VPC origin',
)
assert(ofType('AWS::CloudFront::VpcOrigin').length === 1, 'CloudFront API VPC origin is missing')

const taskDefinitions = ofType('AWS::ECS::TaskDefinition')
assert(taskDefinitions.length >= 3, 'expected API, worker, and migration task definitions')
const containers = taskDefinitions.flatMap(task => task.Properties?.ContainerDefinitions ?? [])
const worker = containers.find(container =>
  (container.Environment ?? []).some(item =>
    item.Name === 'WORKER_VISIBILITY_SECONDS' && item.Value === '1200'))
assert(worker, 'worker must use the queue 20-minute visibility')
const migration = containers.find(container =>
  JSON.stringify(container.Command ?? []).includes('migrate deploy'))
assert(migration, 'one-off Prisma migration task must run migrate deploy')
assert(
  containers.filter(container => container.Name !== migration.Name)
    .every(container => container.LogConfiguration),
  'long-running containers must use centralized logging',
)

assert(ofType('AWS::CloudWatch::Alarm').length >= 5, 'expected operational alarms')
assert(ofType('AWS::CloudWatch::Dashboard').length === 1, 'expected an operations dashboard')

for (const policy of ofType('AWS::IAM::Policy')) {
  for (const statement of policy.Properties?.PolicyDocument?.Statement ?? []) {
    const actions = [].concat(statement.Action ?? [])
    assert(!actions.includes('*'), 'IAM policies must not grant Action "*"')
    assert(!statement.NotAction, 'IAM policies must not use NotAction')
  }
}

console.info('Synthesized development infrastructure passed security and operations assertions')
