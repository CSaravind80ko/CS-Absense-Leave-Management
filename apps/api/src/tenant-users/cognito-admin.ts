import {
  CognitoIdentityProviderClient,
  type CognitoIdentityProviderClientConfig,
} from '@aws-sdk/client-cognito-identity-provider';

export const COGNITO_ADMIN_CLIENT_FACTORY = Symbol(
  'COGNITO_ADMIN_CLIENT_FACTORY',
);

export type CognitoAdminClient = Pick<CognitoIdentityProviderClient, 'send'>;
export type CognitoAdminClientFactory = (region: string) => CognitoAdminClient;

export const createCognitoAdminClient: CognitoAdminClientFactory = (region) => {
  const config: CognitoIdentityProviderClientConfig = { region };
  return new CognitoIdentityProviderClient(config);
};
