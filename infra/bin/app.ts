#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { AttendancePlatformStack } from '../lib/platform-stack.js'

const app = new App()
const stage = app.node.tryGetContext('stage') ?? 'dev'

new AttendancePlatformStack(app, `AttendancePlatform-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1',
  },
})
