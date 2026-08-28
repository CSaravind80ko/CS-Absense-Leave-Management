import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { npm, run } from './lib/commands.mjs'

const directory = mkdtempSync(join(tmpdir(), 'attendance-e2e-local-'))
try {
  npm(['run', 'build'])
  npm([
    'test', '--workspace', '@attendance/api', '--',
    '--runTestsByPath',
    'test/import-storage.service.spec.ts',
    'test/attendance.service.spec.ts',
    'test/live-attendance-workflows.spec.ts',
    'test/identity-membership.service.spec.ts',
  ])
  npm([
    'test', '--workspace', '@attendance/worker', '--',
    '--runTestsByPath',
    'test/events.spec.ts',
    'test/parser.spec.ts',
    'test/outbox-dispatcher.spec.ts',
    'test/worker-ack.spec.ts',
    'test/export-format.spec.ts',
  ])
  npm([
    'run', 'synth', '--workspace', '@attendance/infra', '--',
    'AttendancePlatform-dev',
    '--context', 'stage=dev',
    '--context', 'deploymentAccount=111111111111',
    '--context', 'deploymentRegion=ap-south-1',
    '--context', 'applicationDesiredCount=0',
    '--output', directory,
    '--quiet',
  ])
  const template = join(directory, 'AttendancePlatform-dev.template.json')
  if (!existsSync(template)) throw new Error('CDK synth did not create the expected template')
  run(process.execPath, ['scripts/verify-synth.mjs', '--template', template])
  console.info('Deterministic local Layer 3 E2E fallback passed')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
