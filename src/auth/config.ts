import { CognitoUserPool } from 'amazon-cognito-identity-js'

const authConfig = {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID?.trim() ?? '',
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID?.trim() ?? '',
  region: import.meta.env.VITE_AWS_REGION?.trim() ?? '',
}

export const missingAuthConfig = [
  !authConfig.userPoolId && 'VITE_COGNITO_USER_POOL_ID',
  !authConfig.clientId && 'VITE_COGNITO_CLIENT_ID',
  !authConfig.region && 'VITE_AWS_REGION',
].filter((name): name is string => Boolean(name))

export const userPool = missingAuthConfig.length === 0
  ? new CognitoUserPool({ UserPoolId: authConfig.userPoolId, ClientId: authConfig.clientId })
  : null
