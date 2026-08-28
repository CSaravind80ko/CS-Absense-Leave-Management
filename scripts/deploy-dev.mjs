import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  aws,
  contextArguments,
  npm,
  parseArguments,
  requireValue,
  run,
} from './lib/commands.mjs'

const args = parseArguments(process.argv.slice(2))
const action = requireValue(args, 'action', 'deploy')
const stage = requireValue(args, 'stage')
const account = requireValue(args, 'account', process.env.AWS_ACCOUNT_ID)
const region = requireValue(args, 'region', process.env.AWS_REGION ?? 'ap-south-1')
const callbackUrls = [].concat(args.get('callback-url') ?? [])
const logoutUrls = [].concat(args.get('logout-url') ?? [])
const stackName = `AttendancePlatform-${stage}`

if (stage !== 'dev') {
  throw new Error('This automation is development-only; --stage must be dev')
}
if (!/^\d{12}$/.test(account)) throw new Error('--account must be a 12-digit AWS account ID')
if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) throw new Error('--region is invalid')
if (!['synth', 'diff', 'deploy', 'destroy'].includes(action)) {
  throw new Error('--action must be synth, diff, deploy, or destroy')
}
for (const url of [...callbackUrls, ...logoutUrls]) {
  if (new URL(url).protocol !== 'https:') {
    throw new Error('Additional deployed callback and logout URLs must use HTTPS')
  }
}

const cdk = (script, desiredCount, extra = []) => npm(
  ['run', script, '--workspace', '@attendance/infra', '--', stackName,
    ...contextArguments({
      stage,
      account,
      region,
      desiredCount,
      callbackUrls,
      logoutUrls,
    }),
    ...extra],
)

function assertIdentity() {
  const identity = aws(['sts', 'get-caller-identity', '--region', region])
  if (identity.Account !== account) {
    throw new Error(`AWS identity account does not match --account (caller ends in ${identity.Account.slice(-4)})`)
  }
  console.info(`Using AWS account ending ${identity.Account.slice(-4)} in ${region}`)
}

function outputsAt(path) {
  const document = JSON.parse(readFileSync(path, 'utf8'))
  const outputs = document[stackName]
  if (!outputs) throw new Error(`CDK did not emit outputs for ${stackName}`)
  return outputs
}

function runMigration(outputs) {
  const response = aws([
    'ecs', 'run-task',
    '--region', region,
    '--cluster', outputs.ClusterName,
    '--task-definition', outputs.MigrationTaskDefinitionArn,
    '--launch-type', 'FARGATE',
    '--network-configuration',
    `awsvpcConfiguration={subnets=[${outputs.PrivateSubnetIds}],securityGroups=[${outputs.MigrationSecurityGroupId}],assignPublicIp=DISABLED}`,
    '--started-by', `attendance-${stage}-migration`,
    '--propagate-tags', 'TASK_DEFINITION',
  ])
  const failure = response.failures?.[0]
  if (failure) throw new Error(`Migration task could not start: ${failure.reason}`)
  const taskArn = response.tasks?.[0]?.taskArn
  if (!taskArn) throw new Error('Migration task did not return a task ARN')
  run('aws', [
    'ecs', 'wait', 'tasks-stopped',
    '--region', region,
    '--cluster', outputs.ClusterName,
    '--tasks', taskArn,
  ])
  const task = aws([
    'ecs', 'describe-tasks',
    '--region', region,
    '--cluster', outputs.ClusterName,
    '--tasks', taskArn,
  ]).tasks?.[0]
  const container = task?.containers?.find(item => item.name === outputs.MigrationContainerName)
  if (container?.exitCode !== 0) {
    throw new Error(`Migration task failed with exit code ${container?.exitCode ?? 'unknown'}; inspect ${outputs.MigrationLogGroupName}`)
  }
  console.info('All pending Prisma migrations were applied by the one-off ECS task')
}

async function smoke(url) {
  const endpoint = new URL('/api/v1/health', url)
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: { 'user-agent': 'attendance-dev-deploy-smoke/1.0' },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) {
        const body = await response.json()
        if (body.status === 'ok' && body.database === 'up') {
          console.info(`Dev health check passed at ${endpoint}`)
          return
        }
      }
    } catch {
      // The service and CloudFront distribution can take several minutes to converge.
    }
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }
  throw new Error(`Dev health check did not become ready at ${endpoint}`)
}

if (action === 'synth') {
  npm(['run', 'build'])
  cdk('synth', 0)
} else if (action === 'diff') {
  assertIdentity()
  npm(['run', 'build'])
  cdk('diff', 0)
} else if (action === 'destroy') {
  if (args.get('confirm-destroy') !== 'dev') {
    throw new Error('Dev teardown requires --confirm-destroy dev')
  }
  assertIdentity()
  npm(['run', 'build:web'])
  npm([
    'exec', '--workspace', '@attendance/infra', '--', 'cdk', 'destroy',
    stackName,
    ...contextArguments({
      stage,
      account,
      region,
      desiredCount: 0,
      callbackUrls,
      logoutUrls,
    }),
    '--force',
  ])
} else {
  assertIdentity()
  npm(['run', 'build'])
  npm([
    'exec', '--workspace', '@attendance/infra', '--', 'cdk', 'bootstrap',
    `aws://${account}/${region}`,
  ])
  const directory = mkdtempSync(join(tmpdir(), 'attendance-deploy-'))
  const outputsFile = join(directory, 'outputs.json')
  try {
    cdk('deploy', 0, ['--require-approval', 'never', '--outputs-file', outputsFile])
    const disabledOutputs = outputsAt(outputsFile)
    runMigration(disabledOutputs)
    cdk('deploy', 1, ['--require-approval', 'never', '--outputs-file', outputsFile])
    const enabledOutputs = outputsAt(outputsFile)
    run('aws', [
      'ecs', 'wait', 'services-stable',
      '--region', region,
      '--cluster', enabledOutputs.ClusterName,
      '--services', enabledOutputs.ApiServiceName, enabledOutputs.WorkerServiceName,
    ])
    await smoke(enabledOutputs.ApplicationUrl)
    console.info(`Development deployment ready: ${enabledOutputs.ApplicationUrl}`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
