import {
  Duration,
  RemovalPolicy,
  aws_cognito as cognito,
} from 'aws-cdk-lib'
import { Construct } from 'constructs'

export interface CognitoOidcConnectionProps {
  domainPrefix: string
  callbackUrls: string[]
  logoutUrls: string[]
  removalPolicy: RemovalPolicy
  requireMfa: boolean
}

export class CognitoOidcConnection extends Construct {
  readonly userPool: cognito.UserPool
  readonly userPoolClient: cognito.UserPoolClient
  readonly domain: cognito.UserPoolDomain

  constructor(scope: Construct, id: string, props: CognitoOidcConnectionProps) {
    super(scope, id)

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true,
        tempPasswordValidity: Duration.days(3),
      },
      mfa: props.requireMfa ? cognito.Mfa.REQUIRED : cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: props.removalPolicy,
      deletionProtection: props.requireMfa,
    })
    this.domain = this.userPool.addDomain('ManagedLoginDomain', {
      cognitoDomain: { domainPrefix: props.domainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    })
    this.userPoolClient = this.userPool.addClient('WebOidcClient', {
      authFlows: {},
      generateSecret: false,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: props.callbackUrls,
        logoutUrls: props.logoutUrls,
      },
    })
  }

  issuer(region: string): string {
    return `https://cognito-idp.${region}.amazonaws.com/${this.userPool.userPoolId}`
  }

  hostedUiBaseUrl(): string {
    return this.domain.baseUrl()
  }
}
