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
  policyVersionId: string | null
  calculationTrace: CalculationTrace | null
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

export interface LeaveType {
  id: string
  name: string
  code: string
  paid: boolean
  // Decimal fields serialize as strings.
  defaultAnnualDays: string | null
  active: boolean
}

export interface LeaveBalance {
  id: string
  employeeId: string
  leaveTypeId: string
  year: number
  allocatedDays: string
  usedDays: string
  leaveType: LeaveType
}

export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface LeaveRequest {
  id: string
  employeeId: string
  leaveTypeId: string
  startDate: string
  endDate: string
  halfDay: boolean
  totalDays: string
  reason: string | null
  status: LeaveRequestStatus
  version: number
  decidedAt: string | null
  createdAt: string
  employee: Pick<Employee, 'id' | 'employeeNumber' | 'firstName' | 'lastName'>
  leaveType: LeaveType
  approvalRequests: Array<{ id: string; version: number; status: string }>
}

export type OnDutyCategory = 'CLIENT_VISIT' | 'GOVERNMENT_OFFICE' | 'TRAINING' | 'CONFERENCE' | 'OTHER'
export type OnDutyRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface OnDutyRequest {
  id: string
  employeeId: string
  category: OnDutyCategory
  startDate: string
  endDate: string
  halfDay: boolean
  totalDays: string
  location: string | null
  reason: string
  status: OnDutyRequestStatus
  version: number
  decidedAt: string | null
  createdAt: string
  employee: Pick<Employee, 'id' | 'employeeNumber' | 'firstName' | 'lastName'>
  approvalRequests: Array<{ id: string; version: number; status: string }>
}

export interface ApprovalRequest {
  id: string
  type: 'ATTENDANCE_PERIOD' | 'EXCEPTION' | 'PAYROLL_EXPORT' | 'LEAVE' | 'ON_DUTY'
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  requestedBy: string
  assigneeSubject: string | null
  assigneeRole: ApplicationRole | null
  version: number
  createdAt: string
  period: Pick<ProcessingPeriod, 'id' | 'name' | 'startsOn' | 'endsOn'> | null
  exception: AttendanceException | null
  leaveRequest: LeaveRequest | null
  onDutyRequest: OnDutyRequest | null
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

export type PolicyScopeType = 'TENANT' | 'LOCATION' | 'DEPARTMENT' | 'EMPLOYEE_GROUP' | 'EMPLOYEE'
export type PolicyVersionStatus = 'DRAFT' | 'PUBLISHED'

export interface PolicyRules {
  lateArrival: { graceMinutes: number }
  earlyDeparture: { graceMinutes: number }
  overtime: { thresholdMinutes: number; dailyCapMinutes: number | null; roundingMinutes: number }
  halfDay: { halfDayThresholdMinutes: number }
  absence: { lop: boolean }
}

export interface PolicyVersion {
  id: string
  scopeType: PolicyScopeType
  scopeId: string
  name: string
  status: PolicyVersionStatus
  effectiveFrom: string
  workingWeekdays: number[]
  rules: PolicyRules
  version: number
  publishedAt: string | null
  publishedBy: string | null
  supersedesId: string | null
  createdBy: string
  createdAt: string
}

export interface PolicyResolution {
  policyVersion: PolicyVersion
  rules: PolicyRules
  scopeType: PolicyScopeType
  scopeId: string
  scopeChainEvaluated: Array<{ scopeType: PolicyScopeType; scopeId: string; matched: boolean }>
}

export interface PolicyPreview {
  ruleDiff: Array<{ field: string; from: unknown; to: unknown }>
  affectedEmployeeCount: number
  affectedAttendanceDayCount: number
  dateFrom: string
  dateTo: string
}

export interface EmployeeGroup {
  id: string
  name: string
  code: string
  priority: number
}

export interface EmployeeGroupDetail extends EmployeeGroup {
  members: Array<{
    employeeId: string
    employee: Pick<Employee, 'id' | 'employeeNumber' | 'firstName' | 'lastName'>
  }>
}

export interface OrgUnitOption {
  id: string
  name: string
  code: string
}

export interface Holiday {
  id: string
  name: string
  date: string
  locationId: string | null
}

export interface Shift {
  id: string
  name: string
  code: string
  startMinutes: number
  endMinutes: number
  breakMinutes: number
  graceMinutes: number
  crossesMidnight: boolean
  locationId: string | null
}

export type RecomputeJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface RecomputeJob {
  id: string
  scopeType: PolicyScopeType
  scopeId: string
  dateFrom: string
  dateTo: string
  reason: string
  triggeredByPolicyVersionId: string | null
  requestedBy: string
  status: RecomputeJobStatus
  daysMatched: number
  daysRecomputed: number
  exceptionsOpened: number
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export interface AuditEvent {
  id: string
  actorSubject: string
  action: string
  entityType: string
  entityId: string | null
  occurredAt: string
  requestId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

export interface CalculationTrace {
  policyVersionId: string
  scopeType: PolicyScopeType
  scopeId: string
  effectiveFrom: string
  dayType: 'WORKING' | 'HOLIDAY' | 'WEEKEND' | 'LEAVE'
  workingWeekdays: number[]
  holiday: { id: string; name: string } | null
  leave: { id: string; leaveTypeName: string; halfDay: boolean } | null
  rules: PolicyRules
  computed: {
    scheduledMinutes: number
    workedMinutes: number
    overtimeMinutes: number
    lateMinutes: number
    earlyDepartureMinutes: number
    firstPunchAt: string | null
    lastPunchAt: string | null
  }
  ruleEvaluations: Array<{ rule: string; triggered: boolean; [key: string]: unknown }>
  computedAt: string
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
    getPolicies: (
      input: { scopeType?: PolicyScopeType; scopeId?: string; status?: PolicyVersionStatus } = {},
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams({ pageSize: '100', order: 'desc' })
      if (input.scopeType) query.set('scopeType', input.scopeType)
      if (input.scopeId) query.set('scopeId', input.scopeId)
      if (input.status) query.set('status', input.status)
      return request<Page<PolicyVersion>>(`/policies?${query}`, { signal })
    },
    getEffectivePolicies: (signal?: AbortSignal) =>
      request<PolicyVersion[]>('/policies/effective', { signal }),
    getPolicy: (id: string, signal?: AbortSignal) =>
      request<PolicyVersion>(`/policies/${id}`, { signal }),
    createPolicyDraft: (input: {
      scopeType: PolicyScopeType
      scopeId?: string
      name: string
      effectiveFrom: string
      workingWeekdays: number[]
      rules: PolicyRules
    }) => request<PolicyVersion>('/policies', { method: 'POST', body: JSON.stringify(input) }),
    updatePolicyDraft: (
      id: string,
      input: {
        version: number
        name?: string
        effectiveFrom?: string
        workingWeekdays?: number[]
        rules?: PolicyRules
      },
    ) => request<PolicyVersion>(`/policies/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
    deletePolicyDraft: (id: string) => request<void>(`/policies/${id}`, { method: 'DELETE' }),
    previewPolicyPublish: (id: string, signal?: AbortSignal) =>
      request<PolicyPreview>(`/policies/${id}/preview`, { signal }),
    publishPolicy: (id: string, version: number) =>
      request<{ policyVersion: PolicyVersion; recomputeJobId: string }>(`/policies/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ version }),
      }),
    resolvePolicy: (employeeId: string, date: string) =>
      request<PolicyResolution>('/policies/resolve', {
        method: 'POST',
        body: JSON.stringify({ employeeId, date }),
      }),
    getEmployeeGroups: (signal?: AbortSignal) =>
      request<EmployeeGroup[]>('/employee-groups', { signal }),
    getEmployeeGroup: (id: string, signal?: AbortSignal) =>
      request<EmployeeGroupDetail>(`/employee-groups/${id}`, { signal }),
    createEmployeeGroup: (input: { name: string; code: string; priority?: number }) =>
      request<EmployeeGroup>('/employee-groups', { method: 'POST', body: JSON.stringify(input) }),
    updateEmployeeGroup: (id: string, input: { name?: string; priority?: number }) =>
      request<EmployeeGroup>(`/employee-groups/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    addGroupMember: (id: string, employeeId: string) =>
      request(`/employee-groups/${id}/members`, {
        method: 'POST',
        body: JSON.stringify({ employeeId }),
      }),
    removeGroupMember: (id: string, employeeId: string) =>
      request<void>(`/employee-groups/${id}/members/${employeeId}`, { method: 'DELETE' }),
    getDepartments: (signal?: AbortSignal) =>
      request<OrgUnitOption[]>('/departments', { signal }),
    getLocations: (signal?: AbortSignal) =>
      request<OrgUnitOption[]>('/locations', { signal }),
    getHolidays: (input: { locationId?: string; year?: string } = {}, signal?: AbortSignal) => {
      const query = new URLSearchParams()
      if (input.locationId) query.set('locationId', input.locationId)
      if (input.year) query.set('year', input.year)
      const suffix = query.toString() ? `?${query}` : ''
      return request<Holiday[]>(`/holidays${suffix}`, { signal })
    },
    createHoliday: (input: { name: string; date: string; locationId?: string }) =>
      request<Holiday>('/holidays', { method: 'POST', body: JSON.stringify(input) }),
    updateHoliday: (id: string, input: { name: string; date: string; locationId?: string }) =>
      request<Holiday>(`/holidays/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
    deleteHoliday: (id: string) => request<void>(`/holidays/${id}`, { method: 'DELETE' }),
    getRecomputeJobs: (
      input: { status?: RecomputeJobStatus; page?: number; pageSize?: number } = {},
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams({ order: 'desc' })
      if (input.status) query.set('status', input.status)
      if (input.page) query.set('page', String(input.page))
      if (input.pageSize) query.set('pageSize', String(input.pageSize))
      return request<Page<RecomputeJob>>(`/recompute-jobs?${query}`, { signal })
    },
    getRecomputeJob: (id: string, signal?: AbortSignal) =>
      request<RecomputeJob>(`/recompute-jobs/${id}`, { signal }),
    getShifts: (signal?: AbortSignal) => request<Shift[]>('/shifts', { signal }),
    createShift: (input: {
      name: string
      code: string
      startMinutes: number
      endMinutes: number
      breakMinutes?: number
      graceMinutes?: number
      crossesMidnight?: boolean
      locationId?: string
    }) => request<Shift>('/shifts', { method: 'POST', body: JSON.stringify(input) }),
    updateShift: (id: string, input: {
      name: string
      startMinutes: number
      endMinutes: number
      breakMinutes?: number
      graceMinutes?: number
      crossesMidnight?: boolean
      locationId?: string
    }) => request<Shift>(`/shifts/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
    deleteShift: (id: string) =>
      request<{ unassignedEmployeeCount: number }>(`/shifts/${id}`, { method: 'DELETE' }),
    getAuditEvents: (
      input: {
        entityType?: string
        entityId?: string
        actorSubject?: string
        dateFrom?: string
        dateTo?: string
        page?: number
        pageSize?: number
      } = {},
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams({ order: 'desc' })
      if (input.entityType) query.set('entityType', input.entityType)
      if (input.entityId) query.set('entityId', input.entityId)
      if (input.actorSubject) query.set('actorSubject', input.actorSubject)
      if (input.dateFrom) query.set('dateFrom', input.dateFrom)
      if (input.dateTo) query.set('dateTo', input.dateTo)
      if (input.page) query.set('page', String(input.page))
      if (input.pageSize) query.set('pageSize', String(input.pageSize))
      return request<Page<AuditEvent>>(`/audit-events?${query}`, { signal })
    },
    getAuditEventEntityTypes: (signal?: AbortSignal) =>
      request<string[]>('/audit-events/entity-types', { signal }),
    getLeaveTypes: (includeInactive?: boolean, signal?: AbortSignal) =>
      request<LeaveType[]>(`/leave-types${includeInactive ? '?includeInactive=true' : ''}`, { signal }),
    createLeaveType: (input: { name: string; code: string; paid?: boolean; defaultAnnualDays?: number }) =>
      request<LeaveType>('/leave-types', { method: 'POST', body: JSON.stringify(input) }),
    updateLeaveType: (id: string, input: {
      name: string; paid?: boolean; defaultAnnualDays?: number; active?: boolean
    }) => request<LeaveType>(`/leave-types/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
    getLeaveBalances: (input: { employeeId?: string; year?: number } = {}, signal?: AbortSignal) => {
      const query = new URLSearchParams()
      if (input.employeeId) query.set('employeeId', input.employeeId)
      if (input.year) query.set('year', String(input.year))
      const suffix = query.toString() ? `?${query}` : ''
      return request<LeaveBalance[]>(`/leave-balances${suffix}`, { signal })
    },
    setLeaveBalance: (input: { employeeId: string; leaveTypeId: string; year: number; allocatedDays: number }) =>
      request<LeaveBalance>('/leave-balances', { method: 'POST', body: JSON.stringify(input) }),
    getLeaveRequests: (
      input: {
        employeeId?: string
        status?: LeaveRequestStatus
        leaveTypeId?: string
        page?: number
        pageSize?: number
      } = {},
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams({ order: 'desc' })
      if (input.employeeId) query.set('employeeId', input.employeeId)
      if (input.status) query.set('status', input.status)
      if (input.leaveTypeId) query.set('leaveTypeId', input.leaveTypeId)
      if (input.page) query.set('page', String(input.page))
      if (input.pageSize) query.set('pageSize', String(input.pageSize))
      return request<Page<LeaveRequest>>(`/leave-requests?${query}`, { signal })
    },
    getLeaveRequest: (id: string, signal?: AbortSignal) =>
      request<LeaveRequest>(`/leave-requests/${id}`, { signal }),
    submitLeaveRequest: (input: {
      leaveTypeId: string; startDate: string; endDate: string; halfDay?: boolean; reason?: string
    }) => request<LeaveRequest>('/leave-requests', { method: 'POST', body: JSON.stringify(input) }),
    getOnDutyRequests: (
      input: { employeeId?: string; status?: OnDutyRequestStatus; page?: number; pageSize?: number } = {},
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams({ order: 'desc' })
      if (input.employeeId) query.set('employeeId', input.employeeId)
      if (input.status) query.set('status', input.status)
      if (input.page) query.set('page', String(input.page))
      if (input.pageSize) query.set('pageSize', String(input.pageSize))
      return request<Page<OnDutyRequest>>(`/on-duty-requests?${query}`, { signal })
    },
    getOnDutyRequest: (id: string, signal?: AbortSignal) =>
      request<OnDutyRequest>(`/on-duty-requests/${id}`, { signal }),
    submitOnDutyRequest: (input: {
      category: OnDutyCategory; startDate: string; endDate: string; halfDay?: boolean; location?: string; reason: string
    }) => request<OnDutyRequest>('/on-duty-requests', { method: 'POST', body: JSON.stringify(input) }),
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
