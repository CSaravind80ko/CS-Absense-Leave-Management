const apiUrl = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '')

export interface ApiHealth {
  status: 'ok' | 'unavailable'
  service?: string
  timestamp?: string
}

export interface ApiRequestOptions extends RequestInit {
  accessToken?: string
  tenantId?: string
}

export interface ApiClientOptions {
  getAccessToken: () => Promise<string>
  tenantId?: string
}

export interface TenantMembership {
  id: string
  name: string
  slug: string
  role: string
}

export interface LoginMetadata {
  issuer: string
  clientId: string
  authorizationEndpoint: string
  tokenEndpoint: string
  endSessionEndpoint: string
  scopes: string[]
}

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'TERMINATED'
export type ApplicationRole = 'TENANT_ADMIN' | 'HR_ADMIN' | 'MANAGER' | 'PAYROLL_ADMIN' | 'EMPLOYEE' | 'AUDITOR'

export interface TenantUser {
  id: string
  email: string | null
  role: ApplicationRole
  active: boolean
  lifecycleStatus: 'INVITED' | 'ACTIVE' | 'DISABLED' | 'PASSWORD_RESET_REQUIRED'
  mfaRequired: boolean
  mfaEnforcedByPool: boolean
  mfaStatus: 'TOTP_ENABLED' | 'NOT_ENROLLED' | 'UNKNOWN'
  cognitoStatus: string
  invitedAt: string | null
  disabledAt: string | null
  invitation: {
    status: string
    lastSentAt: string
    resendCount: number
  } | null
}

export interface InviteTenantUserInput {
  email: string
  role: ApplicationRole
  mfaRequired: boolean
}

export type SamlConnectionStatus =
  | 'DRAFT'
  | 'METADATA_VALID'
  | 'PROVISIONING'
  | 'READY'
  | 'ACTIVE'
  | 'DISABLED'
  | 'ERROR'

export interface SamlIdentityConnection {
  id: string
  type: 'SHARED_COGNITO' | 'DEDICATED_COGNITO'
  status: 'ACTIVE' | 'DISABLED'
  issuer: string
  clientId: string
  cognitoUserPoolId: string
  awsRegion: string
  mfaPolicy: 'OPTIONAL' | 'REQUIRED'
  discoverySlug: string | null
  verifiedDomains: string[]
}

export interface SamlCertificateDetails {
  fingerprintSha256: string
  subject?: string
  issuer?: string
  serialNumber?: string
  validFrom?: string
  validTo?: string
  validityState: 'VALID' | 'NOT_YET_VALID' | 'EXPIRED'
}

export interface SamlReadinessResult {
  providerConfigured: boolean
  providerEnabled: boolean
  message: string
  providerHint?: string
  managedLoginUrl?: string
  finalAuthenticationConfirmed?: false
}

export interface SamlTestResult extends SamlReadinessResult {
  providerConfigured: true
  providerEnabled: true
  providerHint: string
  managedLoginUrl: string
  finalAuthenticationConfirmed: false
}

export interface SamlConnection {
  id: string
  identityConnectionId: string
  entityId: string | null
  metadataUrl: string | null
  certificateFingerprints: string[]
  certificateDetails: SamlCertificateDetails[] | null
  cognitoProviderName: string
  attributeMapping: Record<string, string>
  status: SamlConnectionStatus
  metadataValidatedAt: string | null
  provisionedAt: string | null
  testedAt: string | null
  activatedAt: string | null
  disabledAt: string | null
  testResult: SamlReadinessResult | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface ScimCredentialSummary {
  id: string
  tokenPrefix: string
  label: string
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
}

export interface ScimAdminConnection {
  samlConnectionId: string
  providerName: string
  samlStatus: SamlConnectionStatus
  identityStatus: 'ACTIVE' | 'DISABLED'
  identityType: 'SHARED_COGNITO' | 'DEDICATED_COGNITO'
  eligible: boolean
  baseUrl: string
  provisioning: {
    id: string
    enabled: boolean
    defaultRole: ApplicationRole
    privilegedRolePolicy: boolean
    enabledAt: string
    disabledAt: string | null
    credentials: ScimCredentialSummary[]
    _count: { users: number; groups: number }
  } | null
}

export interface ScimCredentialIssue {
  credential: ScimCredentialSummary
  token: string
  baseUrl: string
}

export interface ScimAdminGroup {
  id: string
  displayName: string
  externalId: string | null
  _count: { members: number }
  roleMapping: {
    role: ApplicationRole
    privilegedConfirmedAt: string | null
    updatedAt: string
  } | null
}

export interface ScimAuditEvent {
  id: string
  action: string
  entityType: string
  entityId: string | null
  occurredAt: string
  metadata: Record<string, unknown> | null
}

export interface Employee {
  id: string
  employeeNumber: string
  firstName: string
  lastName: string
  email: string | null
  status: EmployeeStatus
  hireDate: string | null
}

export interface EmployeeInput {
  employeeNumber: string
  firstName: string
  lastName: string
  email?: string
  status: EmployeeStatus
  hireDate?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { accessToken, tenantId, headers, ...requestOptions } = options
  const response = await fetch(`${apiUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    ...requestOptions,
    headers: {
      Accept: 'application/json',
      ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
      ...headers,
    },
  })

  if (!response.ok) {
    const details: unknown = await response.json().catch(() => undefined)
    const message = typeof details === 'object' && details !== null && 'message' in details
      ? String((details as { message: unknown }).message)
      : `API request failed with status ${response.status}`
    throw new ApiError(message, response.status, details)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function createApiClient({ getAccessToken, tenantId }: ApiClientOptions) {
  const request = async <T,>(path: string, options: RequestInit = {}) =>
    apiRequest<T>(path, { ...options, accessToken: await getAccessToken(), tenantId })

  return {
    getTenants: () => request<TenantMembership[]>('/me/tenants'),
    getEmployees: (signal?: AbortSignal) => request<Employee[]>('/employees', { signal }),
    createEmployee: (input: EmployeeInput) => request<Employee>('/employees', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    updateEmployee: (id: string, input: EmployeeInput) => request<Employee>(`/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
    getTenantUsers: () => request<TenantUser[]>('/tenant-users'),
    inviteTenantUser: (input: InviteTenantUserInput) => request('/tenant-users/invitations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    assignTenantUserRole: (id: string, role: ApplicationRole) => request(`/tenant-users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
    setTenantUserMfa: (id: string, required: boolean) => request(`/tenant-users/${id}/mfa-policy`, {
      method: 'PATCH',
      body: JSON.stringify({ required }),
    }),
    disableTenantUser: (id: string) => request(`/tenant-users/${id}/disable`, { method: 'POST' }),
    enableTenantUser: (id: string) => request(`/tenant-users/${id}/enable`, { method: 'POST' }),
    resendTenantUserInvitation: (id: string) => request(`/tenant-users/${id}/resend-invitation`, { method: 'POST' }),
    resetTenantUserPassword: (id: string) => request(`/tenant-users/${id}/reset-password`, { method: 'POST' }),
    getSamlConnections: () => request<SamlConnection[]>('/saml-connections'),
    getSamlIdentityConnections: () =>
      request<SamlIdentityConnection[]>('/saml-connections/identity-connections'),
    createSamlConnection: (input: {
      identityConnectionId: string
      cognitoProviderName: string
      attributeMapping?: Record<string, string>
    }) => request<SamlConnection>('/saml-connections', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    updateSamlMetadata: (
      id: string,
      input: { metadataUrl: string } | { metadataXml: string },
    ) => request<SamlConnection>(`/saml-connections/${id}/metadata`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
    provisionSamlConnection: (id: string) =>
      request<SamlConnection>(`/saml-connections/${id}/provision`, { method: 'POST' }),
    testSamlConnection: (id: string) =>
      request<SamlTestResult>(`/saml-connections/${id}/test`, { method: 'POST' }),
    activateSamlConnection: (id: string) =>
      request<SamlConnection>(`/saml-connections/${id}/activate`, { method: 'POST' }),
    disableSamlConnection: (id: string) =>
      request<SamlConnection>(`/saml-connections/${id}/disable`, { method: 'POST' }),
    getScimConnections: () => request<ScimAdminConnection[]>('/scim-admin'),
    enableScim: (samlConnectionId: string, defaultRole: ApplicationRole) =>
      request<ScimAdminConnection['provisioning']>(`/scim-admin/${samlConnectionId}/enable`, {
        method: 'POST',
        body: JSON.stringify({ defaultRole }),
      }),
    disableScim: (samlConnectionId: string) =>
      request<void>(`/scim-admin/${samlConnectionId}/disable`, { method: 'POST' }),
    issueScimCredential: (
      samlConnectionId: string,
      input: { label: string; expiresAt?: string },
    ) => request<ScimCredentialIssue>(`/scim-admin/${samlConnectionId}/credentials`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    rotateScimCredential: (
      samlConnectionId: string,
      input: { label: string; expiresAt?: string },
    ) => request<ScimCredentialIssue>(`/scim-admin/${samlConnectionId}/credentials/rotate`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    revokeScimCredential: (samlConnectionId: string, credentialId: string) =>
      request<void>(`/scim-admin/${samlConnectionId}/credentials/${credentialId}`, {
        method: 'DELETE',
      }),
    updateScimSettings: (
      samlConnectionId: string,
      input: {
        defaultRole: ApplicationRole
        privilegedRolePolicy: boolean
        confirmPrivilegedAccess?: boolean
      },
    ) => request(`/scim-admin/${samlConnectionId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
    getScimGroups: (samlConnectionId: string) =>
      request<ScimAdminGroup[]>(`/scim-admin/${samlConnectionId}/groups`),
    mapScimGroupRole: (
      samlConnectionId: string,
      groupId: string,
      role: ApplicationRole,
      confirmPrivilegedAccess = false,
    ) => request(`/scim-admin/${samlConnectionId}/groups/${groupId}/role-mapping`, {
      method: 'PUT',
      body: JSON.stringify({ role, confirmPrivilegedAccess }),
    }),
    removeScimGroupRole: (samlConnectionId: string, groupId: string) =>
      request<void>(`/scim-admin/${samlConnectionId}/groups/${groupId}/role-mapping`, {
        method: 'DELETE',
      }),
    getScimEvents: (samlConnectionId: string) =>
      request<ScimAuditEvent[]>(`/scim-admin/${samlConnectionId}/events`),
  }
}

export async function getApiHealth(signal?: AbortSignal): Promise<ApiHealth> {
  return apiRequest<ApiHealth>('/health', { signal })
}

export async function discoverIdentityConnection(
  organization: string,
): Promise<LoginMetadata> {
  return apiRequest<LoginMetadata>('/identity/discovery', {
    method: 'POST',
    body: JSON.stringify({ organization }),
  })
}
