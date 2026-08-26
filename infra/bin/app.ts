#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { AttendancePlatformStack } from '../lib/platform-stack.js'

const app = new App()
const stage = app.node.tryGetContext('stage') ?? 'dev'

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
const identityAdminPoolArns = stringListContext('identityAdminPoolArns') ?? []

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

new AttendancePlatformStack(app, `AttendancePlatform-${stage}`, {
  stage,
  identityCallbackUrls: callbackUrls ?? ['http://localhost:5173'],
  identityLogoutUrls: logoutUrls ?? ['http://localhost:5173'],
  identityDomainPrefix:
    app.node.tryGetContext('identityDomainPrefix') ??
    `attendance-${stage}-${process.env.CDK_DEFAULT_ACCOUNT ?? 'local'}`,
  identityAdminPoolArns,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1',
  },
})
