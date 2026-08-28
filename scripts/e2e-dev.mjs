import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { aws, parseArguments, requireValue, run } from './lib/commands.mjs'

const args = parseArguments(process.argv.slice(2))
const stage = requireValue(args, 'stage', 'dev')
const account = requireValue(args, 'account', process.env.AWS_ACCOUNT_ID)
const region = requireValue(args, 'region', process.env.AWS_REGION ?? 'ap-south-1')
const stackName = requireValue(args, 'stack', `AttendancePlatform-${stage}`)
const runAuthenticated = args.get('authenticated') === true
const runPeriodRace = args.get('period-race') === true
const token = process.env.E2E_BEARER_TOKEN?.trim()
const tenantId = process.env.E2E_TENANT_ID?.trim()
const periodId = process.env.E2E_PERIOD_ID?.trim()
const correlationId = randomUUID()

if (stage !== 'dev') throw new Error('The deployed E2E harness is development-only')
if (!/^\d{12}$/.test(account)) throw new Error('--account must be a 12-digit AWS account ID')
if (runPeriodRace && !runAuthenticated) {
  throw new Error('--period-race requires --authenticated')
}
if (runAuthenticated && (!token || !tenantId || !periodId)) {
  throw new Error('Authenticated E2E requires E2E_BEARER_TOKEN, E2E_TENANT_ID, and E2E_PERIOD_ID')
}

const identity = aws(['sts', 'get-caller-identity', '--region', region])
if (identity.Account !== account) throw new Error('AWS caller account does not match --account')

const stack = aws([
  'cloudformation', 'describe-stacks',
  '--region', region,
  '--stack-name', stackName,
]).Stacks?.[0]
if (!stack) throw new Error(`Stack ${stackName} was not found`)
const outputs = Object.fromEntries(
  (stack.Outputs ?? []).map(item => [item.OutputKey, item.OutputValue]),
)
const requiredOutputs = [
  'ApplicationUrl',
  'ImportBucketName',
  'ExportBucketName',
  'ProcessingQueueUrl',
  'ProcessingDeadLetterQueueUrl',
  'ClusterName',
  'ApiServiceName',
  'WorkerServiceName',
  'WorkerLogGroupName',
]
for (const name of requiredOutputs) {
  if (!outputs[name]) throw new Error(`Stack output ${name} is missing`)
}

function assert(condition, message) {
  if (!condition) throw new Error(`E2E assertion failed: ${message}`)
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path.replace(/^\//, ''), `${outputs.ApplicationUrl}/`), {
    ...options,
    headers: {
      accept: 'application/json',
      'x-correlation-id': correlationId,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(options.timeout ?? 20_000),
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : undefined
  return { response, body }
}

function authHeaders(selectedTenant = tenantId) {
  return {
    authorization: `Bearer ${token}`,
    'x-tenant-id': selectedTenant,
  }
}

async function expectStatus(path, status, options) {
  const result = await request(path, options)
  assert(result.response.status === status, `${path} returned ${result.response.status}, expected ${status}`)
  return result.body
}

async function poll(path, predicate, timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const body = await expectStatus(path, 200, { headers: authHeaders() })
    if (predicate(body)) return body
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  throw new Error(`Timed out polling ${path}`)
}

async function assertBucket(bucket, requireVersioning) {
  const block = aws([
    's3api', 'get-public-access-block', '--region', region, '--bucket', bucket,
  ]).PublicAccessBlockConfiguration
  assert(Object.values(block).every(Boolean), `${bucket} public access block is incomplete`)
  const encryption = aws([
    's3api', 'get-bucket-encryption', '--region', region, '--bucket', bucket,
  ]).ServerSideEncryptionConfiguration?.Rules
  assert(encryption?.length > 0, `${bucket} has no default encryption`)
  if (requireVersioning) {
    const versioning = aws([
      's3api', 'get-bucket-versioning', '--region', region, '--bucket', bucket,
    ])
    assert(versioning.Status === 'Enabled', `${bucket} versioning is not enabled`)
  }
}

async function infrastructureChecks() {
  await Promise.all([
    assertBucket(outputs.ImportBucketName, true),
    assertBucket(outputs.ExportBucketName, true),
  ])
  const cors = aws([
    's3api', 'get-bucket-cors', '--region', region, '--bucket', outputs.ImportBucketName,
  ]).CORSRules
  assert(
    cors.some(rule => rule.AllowedMethods.includes('PUT') &&
      rule.AllowedOrigins.includes(outputs.ApplicationUrl)),
    'import CORS does not allow the deployed CloudFront origin',
  )
  const attributes = aws([
    'sqs', 'get-queue-attributes', '--region', region,
    '--queue-url', outputs.ProcessingQueueUrl,
    '--attribute-names', 'All',
  ]).Attributes
  assert(attributes.FifoQueue === 'true', 'processing queue is not FIFO')
  assert(attributes.VisibilityTimeout === '1200', 'processing queue visibility is not 20 minutes')
  const redrive = JSON.parse(attributes.RedrivePolicy)
  assert(redrive.maxReceiveCount === 5, 'processing queue redrive count is not five')
  assert(redrive.deadLetterTargetArn, 'processing queue has no DLQ')
  const services = aws([
    'ecs', 'describe-services', '--region', region,
    '--cluster', outputs.ClusterName,
    '--services', outputs.ApiServiceName, outputs.WorkerServiceName,
  ]).services
  assert(services.length === 2 && services.every(service => service.status === 'ACTIVE'), 'ECS services are not active')
  assert(services.every(service => service.networkConfiguration?.awsvpcConfiguration?.assignPublicIp === 'DISABLED'), 'ECS tasks may receive public IPs')
  const resources = aws([
    'cloudformation', 'describe-stack-resources', '--region', region, '--stack-name', stackName,
  ]).StackResources
  assert(resources.filter(item => item.ResourceType === 'AWS::CloudWatch::Alarm').length >= 5, 'operational alarms are missing')
  assert(resources.some(item => item.ResourceType === 'AWS::CloudWatch::Dashboard'), 'operations dashboard is missing')

  const health = await expectStatus('/api/v1/health', 200)
  assert(health.status === 'ok' && health.database === 'up', 'API/database health is not ready')
  const page = await fetch(outputs.ApplicationUrl, { signal: AbortSignal.timeout(20_000) })
  assert(page.ok && (await page.text()).includes('<div id="root">'), 'CloudFront did not load the web app')
  console.info('Deployed infrastructure, HTTPS web entrypoint, API routing, storage, queue, alarms, and ECS checks passed')
}

async function createJob() {
  return expectStatus('/api/v1/attendance/imports', 201, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ periodId, source: 'MANUAL_FILE' }),
  })
}

async function reserveUpload(jobId, fileName, contentType, bytes, declaredSize = bytes.length) {
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const reservation = await expectStatus(`/api/v1/attendance/imports/${jobId}/uploads`, 201, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      fileName,
      contentType,
      sizeBytes: declaredSize,
      checksumSha256: checksum,
    }),
  })
  return { reservation, checksum }
}

async function putReservation(reservation, bytes) {
  const response = await fetch(reservation.uploadUrl, {
    method: 'PUT',
    headers: reservation.headers,
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  })
  assert(response.ok, `direct S3 PUT failed with ${response.status}`)
}

async function finalize(jobId, reservation) {
  return expectStatus(
    `/api/v1/attendance/imports/${jobId}/uploads/${reservation.uploadId}/finalize`,
    201,
    { method: 'POST', headers: authHeaders() },
  )
}

async function importFile(fileName, contentType, bytes) {
  const created = await createJob()
  const { reservation } = await reserveUpload(created.job.id, fileName, contentType, bytes)
  await putReservation(reservation, bytes)
  const file = await finalize(created.job.id, reservation)
  const completed = await poll(
    `/api/v1/attendance/imports/${created.job.id}`,
    body => ['COMPLETED', 'FAILED'].includes(body.status),
  )
  return { created, reservation, file, completed }
}

async function replayImport(result) {
  const before = JSON.stringify({
    acceptedRows: result.completed.acceptedRows,
    rejectedRows: result.completed.rejectedRows,
    punchesUpserted: result.completed.punchesUpserted,
    rowSummary: result.completed.rowSummary,
  })
  const event = {
    schemaVersion: 1,
    eventId: result.file.eventId,
    eventType: 'attendance.import.file-ready.v1',
    occurredAt: new Date().toISOString(),
    tenantId,
    periodId,
    importJobId: result.created.job.id,
    importFileId: result.file.id,
    source: 'MANUAL_FILE',
    object: {
      bucket: outputs.ImportBucketName,
      key: result.reservation.storageKey,
      contentType: result.file.contentType,
      sizeBytes: result.file.sizeBytes,
      checksumSha256: result.file.checksum,
    },
  }
  const replayStartedAt = Date.now()
  aws([
    'sqs', 'send-message', '--region', region,
    '--queue-url', outputs.ProcessingQueueUrl,
    '--message-body', JSON.stringify(event),
    '--message-group-id', `tenant:${tenantId}`,
    '--message-deduplication-id', `${event.eventId}:e2e-replay:${Date.now()}`,
  ])
  const deadline = Date.now() + 120_000
  let acknowledged = false
  while (Date.now() < deadline) {
    const events = aws([
      'logs', 'filter-log-events', '--region', region,
      '--log-group-name', outputs.WorkerLogGroupName,
      '--start-time', String(replayStartedAt),
      '--filter-pattern',
      `{ $.correlationId = "${event.eventId}" && $.message = "duplicate event acknowledged" }`,
      '--limit', '1',
    ]).events ?? []
    if (events.length) {
      acknowledged = true
      break
    }
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  assert(acknowledged, 'worker did not positively acknowledge the replayed EventLedger event')
  const after = await expectStatus(`/api/v1/attendance/imports/${result.created.job.id}`, 200, {
    headers: authHeaders(),
  })
  assert(JSON.stringify({
    acceptedRows: after.acceptedRows,
    rejectedRows: after.rejectedRows,
    punchesUpserted: after.punchesUpserted,
    rowSummary: after.rowSummary,
  }) === before, 'EventLedger replay changed import results')
}

async function testRedrive() {
  const suffix = correlationId.replaceAll('-', '').slice(0, 16)
  const dlqName = `attendance-e2e-${suffix}-dlq.fifo`
  const queueName = `attendance-e2e-${suffix}.fifo`
  let queueUrl
  let dlqUrl
  try {
    dlqUrl = aws([
      'sqs', 'create-queue', '--region', region, '--queue-name', dlqName,
      '--attributes', JSON.stringify({
        FifoQueue: 'true',
        SqsManagedSseEnabled: 'true',
        VisibilityTimeout: '1',
      }),
    ]).QueueUrl
    const dlqArn = aws([
      'sqs', 'get-queue-attributes', '--region', region, '--queue-url', dlqUrl,
      '--attribute-names', 'QueueArn',
    ]).Attributes.QueueArn
    queueUrl = aws([
      'sqs', 'create-queue', '--region', region, '--queue-name', queueName,
      '--attributes', JSON.stringify({
        FifoQueue: 'true',
        SqsManagedSseEnabled: 'true',
        VisibilityTimeout: '1',
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: '5',
        }),
      }),
    ]).QueueUrl
    aws([
      'sqs', 'send-message', '--region', region, '--queue-url', queueUrl,
      '--message-body', JSON.stringify({ controlledFailure: correlationId }),
      '--message-group-id', correlationId,
      '--message-deduplication-id', correlationId,
    ])
    for (let receive = 1; receive <= 5; receive += 1) {
      const message = aws([
        'sqs', 'receive-message', '--region', region, '--queue-url', queueUrl,
        '--wait-time-seconds', '2', '--visibility-timeout', '0',
        '--attribute-names', 'ApproximateReceiveCount',
      ]).Messages?.[0]
      assert(message, `controlled failure was unavailable at receive ${receive}`)
      assert(Number(message.Attributes.ApproximateReceiveCount) === receive, 'receive count did not increase')
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
    const dead = aws([
      'sqs', 'receive-message', '--region', region, '--queue-url', dlqUrl,
      '--wait-time-seconds', '10',
    ]).Messages?.[0]
    assert(dead, 'controlled failure did not reach the DLQ after five receives')
  } finally {
    if (queueUrl) run('aws', ['sqs', 'delete-queue', '--region', region, '--queue-url', queueUrl])
    if (dlqUrl) run('aws', ['sqs', 'delete-queue', '--region', region, '--queue-url', dlqUrl])
  }
}

async function authenticatedChecks() {
  const fixture = await readFile(new URL('../fixtures/attendance-import.csv', import.meta.url))
  const valid = await importFile('attendance-import.csv', 'text/csv', fixture)
  assert(valid.completed.status === 'COMPLETED', `valid import failed: ${valid.completed.errorCode}`)
  assert(valid.completed.acceptedRows === 2 && valid.completed.punchesUpserted <= 2, 'valid row/punch totals are unexpected')
  assert(valid.completed.files?.[0]?._count?.rows === 2, 'retained row total is unexpected')
  await replayImport(valid)

  const publicObject = await fetch(
    `https://${outputs.ImportBucketName}.s3.${region}.amazonaws.com/${valid.reservation.storageKey}`,
    { redirect: 'manual', signal: AbortSignal.timeout(20_000) },
  )
  assert([401, 403, 404].includes(publicObject.status), 'import object is publicly readable')

  const foreign = await request(`/api/v1/attendance/imports/${valid.created.job.id}`, {
    headers: authHeaders(randomUUID()),
  })
  assert([403, 404].includes(foreign.response.status), 'cross-tenant import read was not denied')

  const oversized = await createJob()
  const oversizeResponse = await request(`/api/v1/attendance/imports/${oversized.job.id}/uploads`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      fileName: 'oversize.csv',
      contentType: 'text/csv',
      sizeBytes: 26_214_401,
      checksumSha256: '0'.repeat(64),
    }),
  })
  assert(oversizeResponse.response.status === 400, 'oversize upload reservation was not rejected')

  const malformed = await importFile(
    'malformed.csv',
    'text/csv',
    Buffer.from('wrong,headers\nvalue,value\n'),
  )
  assert(malformed.completed.status === 'FAILED', 'malformed CSV did not fail')

  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Attendance')
  sheet.addRow(['employeeNumber', 'occurredAt', 'punchType'])
  sheet.addRow([{ formula: '"DEMO-1001"', result: 'DEMO-1001' }, '2026-08-03 09:00', 'IN'])
  const formulaBytes = Buffer.from(await workbook.xlsx.writeBuffer())
  const formula = await importFile(
    'formula.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    formulaBytes,
  )
  assert(formula.completed.rejectedRows === 1, 'formula row was not rejected')

  const staleCreated = await createJob()
  const staleUpload = await reserveUpload(
    staleCreated.job.id,
    'stale.csv',
    'text/csv',
    fixture,
  )
  await putReservation(staleUpload.reservation, fixture)
  let period = await expectStatus(`/api/v1/attendance/periods/${periodId}`, 200, {
    headers: authHeaders(),
  })
  if (period.status === 'OPEN') {
    period = await expectStatus(`/api/v1/attendance/periods/${periodId}/status`, 200, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'PROCESSING', version: period.version }),
    })
  }
  if (period.status === 'PROCESSING') {
    period = await expectStatus(`/api/v1/attendance/periods/${periodId}/status`, 200, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'REVIEW', version: period.version }),
    })
  }
  await finalize(staleCreated.job.id, staleUpload.reservation)
  const stale = await poll(
    `/api/v1/attendance/imports/${staleCreated.job.id}`,
    body => body.status === 'FAILED',
  )
  assert(stale.errorCode === 'PERIOD_NOT_IMPORTABLE', 'stale-period import returned the wrong error')

  if (period.status !== 'REVIEW') throw new Error('E2E period must reach REVIEW before payroll')
  period = await expectStatus(`/api/v1/attendance/periods/${periodId}/status`, 200, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'APPROVED', version: period.version }),
  })
  const payroll = await expectStatus('/api/v1/payroll/exports', 201, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ periodId, periodVersion: period.version, format: 'CSV' }),
  })
  const ready = await poll(
    `/api/v1/payroll/exports/${payroll.payrollExport.id}`,
    body => ['READY', 'FAILED'].includes(body.status),
  )
  assert(ready.status === 'READY', `payroll export failed: ${ready.errorCode}`)
  const download = await expectStatus(`/api/v1/payroll/exports/${ready.id}/download`, 200, {
    headers: authHeaders(),
  })
  assert(new Date(download.expiresAt).getTime() - Date.now() <= 310_000, 'payroll URL is not short lived')
  const downloaded = await fetch(download.downloadUrl, { signal: AbortSignal.timeout(30_000) })
  assert(downloaded.ok, 'authorized payroll download failed')
  const publicPayroll = await fetch(
    `https://${outputs.ExportBucketName}.s3.${region}.amazonaws.com/${ready.storageKey}`,
    { redirect: 'manual', signal: AbortSignal.timeout(20_000) },
  )
  assert([401, 403, 404].includes(publicPayroll.status), 'payroll object is publicly readable')

  if (runPeriodRace) {
    const resourceId = `service/${outputs.ClusterName}/${outputs.WorkerServiceName}`
    const target = aws([
      'application-autoscaling', 'describe-scalable-targets',
      '--region', region,
      '--service-namespace', 'ecs',
      '--resource-ids', resourceId,
      '--scalable-dimension', 'ecs:service:DesiredCount',
    ]).ScalableTargets?.[0]
    assert(target, 'worker autoscaling target was not found')
    const workerService = aws([
      'ecs', 'describe-services', '--region', region,
      '--cluster', outputs.ClusterName,
      '--services', outputs.WorkerServiceName,
    ]).services?.[0]
    assert(workerService, 'worker service was not found')
    const originalDesiredCount = workerService.desiredCount
    const suspendedState = JSON.stringify({
      DynamicScalingInSuspended: true,
      DynamicScalingOutSuspended: true,
      ScheduledScalingSuspended: true,
    })
    const originalSuspendedState = JSON.stringify(target.SuspendedState ?? {
      DynamicScalingInSuspended: false,
      DynamicScalingOutSuspended: false,
      ScheduledScalingSuspended: false,
    })
    try {
      run('aws', [
        'application-autoscaling', 'register-scalable-target',
        '--region', region,
        '--service-namespace', 'ecs',
        '--resource-id', resourceId,
        '--scalable-dimension', 'ecs:service:DesiredCount',
        '--min-capacity', '0',
        '--max-capacity', String(target.MaxCapacity),
        '--suspended-state', suspendedState,
      ])
      run('aws', [
        'ecs', 'update-service', '--region', region,
        '--cluster', outputs.ClusterName,
        '--service', outputs.WorkerServiceName,
        '--desired-count', '0',
      ])
      run('aws', [
        'ecs', 'wait', 'services-stable', '--region', region,
        '--cluster', outputs.ClusterName,
        '--services', outputs.WorkerServiceName,
      ])
      const racing = await expectStatus('/api/v1/payroll/exports', 201, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ periodId, periodVersion: period.version, format: 'CSV' }),
      })
      period = await expectStatus(`/api/v1/attendance/periods/${periodId}/status`, 200, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          status: 'REVIEW',
          version: period.version,
          reason: `Layer 3 race test ${correlationId}`,
        }),
      })
      run('aws', [
        'application-autoscaling', 'register-scalable-target',
        '--region', region,
        '--service-namespace', 'ecs',
        '--resource-id', resourceId,
        '--scalable-dimension', 'ecs:service:DesiredCount',
        '--min-capacity', String(target.MinCapacity),
        '--max-capacity', String(target.MaxCapacity),
        '--suspended-state', originalSuspendedState,
      ])
      run('aws', [
        'ecs', 'update-service', '--region', region,
        '--cluster', outputs.ClusterName,
        '--service', outputs.WorkerServiceName,
        '--desired-count', String(originalDesiredCount),
      ])
      const failed = await poll(
        `/api/v1/payroll/exports/${racing.payrollExport.id}`,
        body => body.status === 'FAILED',
      )
      assert(failed.errorCode === 'PERIOD_VERSION_STALE', 'period race did not fail with PERIOD_VERSION_STALE')
      const staleDownload = await request(`/api/v1/payroll/exports/${failed.id}/download`, {
        headers: authHeaders(),
      })
      assert(staleDownload.response.status === 409, 'stale payroll export exposed a download')
    } finally {
      run('aws', [
        'application-autoscaling', 'register-scalable-target',
        '--region', region,
        '--service-namespace', 'ecs',
        '--resource-id', resourceId,
        '--scalable-dimension', 'ecs:service:DesiredCount',
        '--min-capacity', String(target.MinCapacity),
        '--max-capacity', String(target.MaxCapacity),
        '--suspended-state', originalSuspendedState,
      ])
      run('aws', [
        'ecs', 'update-service', '--region', region,
        '--cluster', outputs.ClusterName,
        '--service', outputs.WorkerServiceName,
        '--desired-count', String(originalDesiredCount),
      ])
    }
  }
  console.info(`Authenticated import/payroll E2E passed (correlation ${correlationId})`)
}

await infrastructureChecks()
await testRedrive()
if (runAuthenticated) {
  await authenticatedChecks()
} else {
  console.info('Authenticated flow skipped; rerun with --authenticated after completing the documented Cognito bootstrap')
}
