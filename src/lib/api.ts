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

export class ApiError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(
    message: string,
    status: number,
    details?: unknown,
  ) {
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
    const details = await response.json().catch(() => undefined)
    throw new ApiError(`API request failed with status ${response.status}`, response.status, details)
  }

  return response.json() as Promise<T>
}

export async function getApiHealth(signal?: AbortSignal): Promise<ApiHealth> {
  return apiRequest<ApiHealth>('/health', { signal })
}
