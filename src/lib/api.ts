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
  role: ApplicationRole
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

export type PeriodStatus = 'OPEN' | 'PROCESSING' | 'REVIEW' | 'APPROVED' | 'EXPORTED' | 'CLOSED'
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'PARTIAL' | 'LEAVE' | 'HOLIDAY' | 'WEEKEND'
export type ExceptionStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED'
export type ExceptionSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type PayrollImpact = 'NONE' | 'REVIEW_REQUIRED' | 'UNPAID_MINUTES' | 'BLOCKED'

export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface ProcessingPeriod {
  id: string
  name: string
  startsOn: string
  endsOn: string
  status: PeriodStatus
  version: number
  lockedAt: string | null
  reopenedAt: string | null
  reopenReason: string | null
  updatedAt: string
}

export interface AttendanceRegisterItem {
  id: string
  workDate: string
  status: AttendanceStatus
  scheduledMinutes: number
  workedMinutes: number
  overtimeMinutes: number
  lateMinutes: number
  firstPunchAt: string | null
  lastPunchAt: string | null
  version: number
  employee: Employee & {
    department: { id: string; name: string } | null
    location: { id: string; name: string } | null
    shift: { id: string; name: string } | null
  }
  exceptions: Array<{
    id: string
    severity: ExceptionSeverity
    payrollImpact: PayrollImpact
    type: string
  }>
}

export interface AttendanceDayDetail extends AttendanceRegisterItem {
  period: ProcessingPeriod
  punches: Array<{
    id: string
    occurredAt: string
    type: string
    source: string
    externalId: string | null
    location: { id: string; name: string } | null
  }>
}

export interface AttendanceException {
  id: string
  type: string
  status: ExceptionStatus
  severity: ExceptionSeverity
  payrollImpact: PayrollImpact
  payrollImpactMinutes: number
  assignedToSubject: string | null
  assignedToRole: ApplicationRole | null
  details: Record<string, unknown> | null
  resolutionNote: string | null
  version: number
  createdAt: string
  employee: (Employee & { department?: { id: string; name: string } | null }) | null
  attendanceDay: { id: string; workDate: string; status: AttendanceStatus; version: number } | null
}

export interface ExceptionPage extends Page<AttendanceException> {
  summary: { open: number; critical: number; blocked: number }
}

export interface ApprovalAction {
  id: string
  action: string
  actorSubject: string
  comment: string | null
  createdAt: string
}

export interface ApprovalRequest {
  id: string
  type: 'ATTENDANCE_PERIOD' | 'EXCEPTION' | 'PAYROLL_EXPORT'
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  requestedBy: string
  assigneeSubject: string | null
  assigneeRole: ApplicationRole | null
  version: number
  createdAt: string
  period: Pick<ProcessingPeriod, 'id' | 'name' | 'startsOn' | 'endsOn'> | null
  exception: AttendanceException | null
  actions: ApprovalAction[]
}

export interface PayrollRegisterItem {
  employee: Employee & { department: { id: string; name: string } | null }
  regularMinutes: number
  overtimeMinutes: number
  unpaidMinutes: number
  attendanceDays: number
  readiness: 'READY' | 'BLOCKED'
}

export interface PayrollRegister extends Page<PayrollRegisterItem> {
  period: ProcessingPeriod
  readiness: { total: number; ready: number; blocked: number; readinessPercent: number }
}

export interface AttendanceDashboard {
  period: ProcessingPeriod
  metrics: {
    activeEmployees: number
    attendanceProcessed: number
    payrollReady: number
    openExceptions: number
    criticalBlockers: number
    pendingApprovals: number
    readinessPercent: number
  }
  imports: AttendanceImportJob[]
  recentActivity: Array<{
    id: string
    action: string
    actorSubject: string
    occurredAt: string
  }>
}

export interface AttendanceImportJob {
  id: string
  periodId: string
  source: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  requestedBy: string
  errorMessage: string | null
  errorCode: string | null
  acceptedRows: number
  rejectedRows: number
  punchesUpserted: number
  attendanceDaysUpdated: number
  exceptionsOpened: number
  createdAt: string
}

export interface AttendanceImportDetail extends AttendanceImportJob {
  files: Array<{
    id: string
    fileName: string
    contentType: string
    sizeBytes: string
    checksum: string
    createdAt: string
    _count: { rows: number }
  }>
  rowSummary: Partial<Record<'PENDING' | 'VALID' | 'INVALID' | 'PROCESSED', number>>
}

export interface ImportUploadReservation {
  uploadId: string
  method: 'PUT'
  uploadUrl: string
  storageKey: string
  expiresAt: string
  headers: Record<string, string>
}

export interface PayrollExport {
  id: string
  periodId: string
  periodVersion: number
  format: 'CSV' | 'XLSX'
  status: 'DRAFT' | 'GENERATING' | 'READY' | 'FAILED' | 'DELIVERED'
  errorCode: string | null
  checksum: string | null
  generatedAt: string | null
  createdAt: string
  _count: { items: number }
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
    getAttendancePeriods: () =>
      request<Page<ProcessingPeriod>>('/attendance/periods?pageSize=100&order=desc'),
    createAttendancePeriod: (input: { name: string; startsOn: string; endsOn: string }) =>
      request<ProcessingPeriod>('/attendance/periods', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    transitionAttendancePeriod: (
      id: string,
      input: { status: PeriodStatus; version: number; reason?: string },
    ) => request<ProcessingPeriod>(`/attendance/periods/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
    getAttendanceDashboard: (periodId: string, signal?: AbortSignal) =>
      request<AttendanceDashboard>(`/attendance/dashboard?periodId=${encodeURIComponent(periodId)}`, { signal }),
    getAttendanceRegister: (
      periodId: string,
      input: { search?: string; status?: AttendanceStatus; page?: number } = {},
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams({ periodId, page: String(input.page ?? 1), pageSize: '50' })
      if (input.search) query.set('search', input.search)
      if (input.status) query.set('status', input.status)
      return request<Page<AttendanceRegisterItem>>(`/attendance/register?${query}`, { signal })
    },
    getAttendanceDay: (id: string, signal?: AbortSignal) =>
      request<AttendanceDayDetail>(`/attendance/days/${id}`, { signal }),
    getAttendanceImports: (periodId: string, signal?: AbortSignal) =>
      request<Page<AttendanceImportJob>>(`/attendance/imports?periodId=${encodeURIComponent(periodId)}&pageSize=50`, { signal }),
    getAttendanceImport: (id: string, signal?: AbortSignal) =>
      request<AttendanceImportDetail>(`/attendance/imports/${id}`, { signal }),
    requestAttendanceImport: (periodId: string, source: string) =>
      request<{ job: AttendanceImportJob; workerConnected: true }>('/attendance/imports', {
        method: 'POST',
        body: JSON.stringify({ periodId, source }),
      }),
    createAttendanceImportUpload: (
      id: string,
      input: { fileName: string; contentType: string; sizeBytes: number; checksumSha256: string },
    ) => request<ImportUploadReservation>(`/attendance/imports/${id}/uploads`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    uploadAttendanceFile: async (upload: ImportUploadReservation, file: File) => {
      const response = await fetch(upload.uploadUrl, {
        method: upload.method,
        headers: upload.headers,
        body: file,
      })
      if (!response.ok) throw new ApiError('Private object upload failed', response.status)
    },
    finalizeAttendanceImport: (id: string, uploadId: string) =>
      request(`/attendance/imports/${id}/uploads/${uploadId}/finalize`, {
        method: 'POST',
      }),
    getExceptions: (
      periodId: string,
      input: { search?: string; status?: ExceptionStatus; severity?: ExceptionSeverity } = {},
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams({ periodId, pageSize: '50' })
      if (input.search) query.set('search', input.search)
      if (input.status) query.set('status', input.status)
      if (input.severity) query.set('severity', input.severity)
      return request<ExceptionPage>(`/exceptions?${query}`, { signal })
    },
    getException: (id: string, signal?: AbortSignal) =>
      request<AttendanceException>(`/exceptions/${id}`, { signal }),
    decideException: (
      id: string,
      input: { decision: Exclude<ExceptionStatus, 'OPEN'>; note: string; version: number },
    ) => request<AttendanceException>(`/exceptions/${id}/decision`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
    assignException: (
      id: string,
      input: { version: number; assignedToSubject?: string; assignedToRole?: ApplicationRole },
    ) => request<AttendanceException>(`/exceptions/${id}/assignment`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
    getApprovals: (
      input: { periodId?: string; status?: ApprovalRequest['status']; scope?: 'inbox' | 'requested' | 'all' } = {},
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams({ pageSize: '50', scope: input.scope ?? 'inbox' })
      if (input.periodId) query.set('periodId', input.periodId)
      if (input.status) query.set('status', input.status)
      return request<Page<ApprovalRequest>>(`/approvals?${query}`, { signal })
    },
    actOnApproval: (
      id: string,
      input: { action: 'APPROVED' | 'REJECTED' | 'COMMENTED' | 'CANCELLED'; comment?: string; version: number },
    ) => request<ApprovalRequest>(`/approvals/${id}/actions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    getPayrollRegister: (periodId: string, search = '', signal?: AbortSignal) => {
      const query = new URLSearchParams({ periodId, pageSize: '50' })
      if (search) query.set('search', search)
      return request<PayrollRegister>(`/payroll/register?${query}`, { signal })
    },
    getPayrollExports: (periodId: string, signal?: AbortSignal) =>
      request<Page<PayrollExport>>(`/payroll/exports?periodId=${encodeURIComponent(periodId)}&pageSize=20`, { signal }),
    requestPayrollExport: (
      periodId: string,
      periodVersion: number,
      format: 'CSV' | 'XLSX',
      approvalRequestId?: string,
    ) => request<{ payrollExport: PayrollExport; workerConnected: true }>('/payroll/exports', {
      method: 'POST',
      body: JSON.stringify({ periodId, periodVersion, format, approvalRequestId }),
    }),
    getPayrollExportDownload: (id: string) =>
      request<{ downloadUrl: string; expiresAt: string; checksumSha256: string }>(
        `/payroll/exports/${id}/download`,
      ),
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

export type ApiClient = ReturnType<typeof createApiClient>

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
