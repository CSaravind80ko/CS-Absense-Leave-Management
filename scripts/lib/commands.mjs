import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.error) {
    throw new Error(`Unable to start ${command}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = options.capture
      ? `: ${(result.stderr || result.stdout).trim().slice(0, 2000)}`
      : ''
    throw new Error(`${command} exited with code ${result.status}${detail}`)
  }
  return options.capture ? result.stdout.trim() : ''
}

export function npm(args, options) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args], options)
  }
  const bundledCli = join(
    dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js',
  )
  if (existsSync(bundledCli)) {
    return run(process.execPath, [bundledCli, ...args], options)
  }
  return run('npm', args, options)
}

export function aws(args) {
  const output = run('aws', [...args, '--output', 'json'], { capture: true })
  return output ? JSON.parse(output) : undefined
}

export function parseArguments(argv) {
  const result = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      result.set(key.slice(2), true)
      continue
    }
    const name = key.slice(2)
    const existing = result.get(name)
    result.set(name, existing ? [].concat(existing, next) : next)
    index += 1
  }
  return result
}

export function requireValue(args, name, fallback) {
  const value = args.get(name) ?? fallback
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`--${name} is required`)
  }
  return value.trim()
}

export function contextArguments({ stage, account, region, desiredCount, callbackUrls, logoutUrls }) {
  const contexts = [
    `stage=${stage}`,
    `deploymentAccount=${account}`,
    `deploymentRegion=${region}`,
    `applicationDesiredCount=${desiredCount}`,
  ]
  if (callbackUrls.length) {
    contexts.push(`identityCallbackUrls=${JSON.stringify(callbackUrls)}`)
  }
  if (logoutUrls.length) {
    contexts.push(`identityLogoutUrls=${JSON.stringify(logoutUrls)}`)
  }
  return contexts.flatMap(value => ['--context', value])
}
