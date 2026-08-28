#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { AttendancePlatformStack } from '../lib/platform-stack.js'

const app = new App()
const stageContext: unknown = app.node.tryGetContext('stage')
const stage = stageContext === undefined ? 'dev' : stageContext

if (typeof stage !== 'string' || !['dev', 'staging', 'prod'].includes(stage)) {
  throw new Error('stage must be one of: dev, staging, prod')
}

const productionOptIn: unknown = app.node.tryGetContext('allowProductionDeployment')
if (
  stage === 'prod' &&
  productionOptIn !== true &&
  productionOptIn !== 'true'
) {
  throw new Error(
    'Production synth requires -c allowProductionDeployment=true',
  )
}

const accountContext: unknown =
  app.node.tryGetContext('deploymentAccount') ??
  process.env.CDK_DEFAULT_ACCOUNT
const account =
  typeof accountContext === 'number' ? String(accountContext) : accountContext
if (typeof account !== 'string' || !/^\d{12}$/.test(account) || /^0+$/.test(account)) {
  throw new Error(
    'A valid 12-digit deploymentAccount context or CDK_DEFAULT_ACCOUNT is required',
  )
}

const regionContext: unknown =
  app.node.tryGetContext('deploymentRegion') ??
  process.env.CDK_DEFAULT_REGION ??
  'ap-south-1'
if (
  typeof regionContext !== 'string' ||
  !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(regionContext)
) {
  throw new Error('deploymentRegion must be a valid explicit AWS region name')
}
const region = regionContext

const availabilityZoneContextKey =
  `availability-zones:account=${account}:region=${region}`
if (app.node.tryGetContext(availabilityZoneContextKey) === undefined) {
  app.node.setContext(availabilityZoneContextKey, [`${region}a`, `${region}b`])
}

function stringListContext(name: string): string[] | undefined {
  const value: unknown = app.node.tryGetContext(name)
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value
  }
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
      return parsed
    }
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean)
  }
  throw new Error(`${name} must be a JSON array or comma-separated URL list`)
}

const callbackUrls = stringListContext('identityCallbackUrls')
const logoutUrls = stringListContext('identityLogoutUrls')
const webCorsOrigins = stringListContext('webCorsOrigins') ?? []
const identityAdminPoolArns = stringListContext('identityAdminPoolArns') ?? []

function validateWebUrls(name: string, urls: string[], originOnly = false): void {
  for (const value of urls) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error(`${name} contains an invalid URL: ${value}`)
    }
    const localHttp =
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(stage !== 'prod' && localHttp)) {
      throw new Error(`${name} URLs must use HTTPS (HTTP is allowed only for local non-production URLs)`)
    }
    if (url.username || url.password || url.hash) {
      throw new Error(`${name} URLs cannot contain credentials or fragments`)
    }
    if (
      originOnly &&
      (url.origin !== value.replace(/\/$/, '') || url.pathname !== '/' || url.search)
    ) {
      throw new Error(`${name} entries must be origins without a path, query, or fragment`)
    }
  }
}

validateWebUrls('identityCallbackUrls', callbackUrls ?? [])
validateWebUrls('identityLogoutUrls', logoutUrls ?? [])
validateWebUrls('webCorsOrigins', webCorsOrigins, true)

if (identityAdminPoolArns.some(arn =>
  !/^arn:(?:aws|aws-us-gov|aws-cn|aws-iso|aws-iso-b):cognito-idp:[a-z0-9-]+:\d{12}:userpool\/[A-Za-z0-9_-]+$/.test(arn),
)) {
  throw new Error(
    'identityAdminPoolArns must contain exact Cognito user-pool ARNs; wildcards are not allowed',
  )
}

if (stage === 'prod' && (!callbackUrls?.length || !logoutUrls?.length)) {
  throw new Error(
    'Production synth requires identityCallbackUrls and identityLogoutUrls context arrays',
  )
}

const desiredCountContext: unknown =
  app.node.tryGetContext('applicationDesiredCount') ?? 'normal'
let applicationDesiredCount: number
if (desiredCountContext === 'normal') {
  applicationDesiredCount = 1
} else if (typeof desiredCountContext === 'number') {
  applicationDesiredCount = desiredCountContext
} else if (
  typeof desiredCountContext === 'string' &&
  /^(?:0|1)$/.test(desiredCountContext)
) {
  applicationDesiredCount = Number(desiredCountContext)
} else {
  throw new Error('applicationDesiredCount must be 0, 1, or "normal"')
}
if (
  !Number.isInteger(applicationDesiredCount) ||
  (applicationDesiredCount !== 0 && applicationDesiredCount !== 1)
) {
  throw new Error('applicationDesiredCount must be 0, 1, or "normal"')
}

const identityDomainPrefixContext: unknown =
  app.node.tryGetContext('identityDomainPrefix')
const identityDomainPrefix =
  identityDomainPrefixContext ??
  `attendance-${stage}-${account}-${region}`
if (
  typeof identityDomainPrefix !== 'string' ||
  !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(identityDomainPrefix)
) {
  throw new Error(
    'identityDomainPrefix must be 1-63 lowercase letters, numbers, or hyphens and cannot start or end with a hyphen',
  )
}

new AttendancePlatformStack(app, `AttendancePlatform-${stage}`, {
  stage,
  identityCallbackUrls: callbackUrls ?? ['http://localhost:5173'],
  identityLogoutUrls: logoutUrls ?? ['http://localhost:5173'],
  identityDomainPrefix,
  identityAdminPoolArns,
  webCorsOrigins,
  applicationDesiredCount,
  env: {
    account,
    region,
  },
})
