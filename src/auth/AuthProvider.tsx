import {
  UserManager,
  WebStorageStateStore,
  type User,
  type UserManagerSettings,
} from 'oidc-client-ts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { discoverIdentityConnection, type LoginMetadata } from '../lib/api'
import { AuthContext, type AuthContextValue, type AuthUser } from './auth-context'
import { authRuntimeConfig, missingAuthConfig } from './config'

const loginMetadataKey = 'attendance.login.metadata'

function authUser(user: User): AuthUser {
  return {
    subject: user.profile.sub,
    email: typeof user.profile.email === 'string' ? user.profile.email : undefined,
  }
}

function validMetadata(value: unknown): value is LoginMetadata {
  if (!value || typeof value !== 'object') return false
  const metadata = value as Record<string, unknown>
  const stringFieldsValid = [
    'issuer',
    'clientId',
    'authorizationEndpoint',
    'tokenEndpoint',
    'endSessionEndpoint',
  ].every(name => typeof metadata[name] === 'string') &&
    Array.isArray(metadata.scopes) &&
    metadata.scopes.every(scope => typeof scope === 'string')
  if (!stringFieldsValid || !(metadata.scopes as string[]).includes('openid')) return false
  return [
    metadata.issuer,
    metadata.authorizationEndpoint,
    metadata.tokenEndpoint,
    metadata.endSessionEndpoint,
  ].every(value => {
    try {
      return new URL(value as string).protocol === 'https:'
    } catch {
      return false
    }
  })
}

function readMetadata(): LoginMetadata | null {
  const stored = window.sessionStorage.getItem(loginMetadataKey)
  if (!stored) return null
  try {
    const parsed: unknown = JSON.parse(stored)
    return validMetadata(parsed) ? parsed : null
  } catch {
    return null
  }
}

function createManager(metadata: LoginMetadata): UserManager {
  const settings: UserManagerSettings = {
    authority: metadata.issuer,
    client_id: metadata.clientId,
    redirect_uri: authRuntimeConfig.redirectUri,
    post_logout_redirect_uri: authRuntimeConfig.postLogoutRedirectUri,
    response_type: 'code',
    scope: metadata.scopes.join(' '),
    automaticSilentRenew: true,
    loadUserInfo: false,
    monitorSession: false,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    metadata: {
      issuer: metadata.issuer,
      authorization_endpoint: metadata.authorizationEndpoint,
      token_endpoint: metadata.tokenEndpoint,
      end_session_endpoint: metadata.endSessionEndpoint,
      jwks_uri: `${metadata.issuer.replace(/\/$/, '')}/.well-known/jwks.json`,
    },
  }
  return new UserManager(settings)
}

function isAuthorizationResponse(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.has('code') || params.has('error')
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>(
    missingAuthConfig.length === 0 ? 'loading' : 'misconfigured',
  )
  const [user, setUser] = useState<AuthUser | null>(null)
  const [error, setError] = useState('')
  const manager = useRef<UserManager | null>(null)

  const installManager = useCallback((metadata: LoginMetadata) => {
    manager.current = createManager(metadata)
    manager.current.events.addSilentRenewError(() => {
      setUser(null)
      setError('Your session could not be refreshed. Sign in again.')
      setStatus('error')
    })
    manager.current.events.addUserSignedOut(() => {
      setUser(null)
      setStatus('unauthenticated')
    })
    return manager.current
  }, [])

  useEffect(() => {
    if (missingAuthConfig.length > 0) return
    const metadata = readMetadata()
    if (!metadata) {
      window.sessionStorage.removeItem(loginMetadataKey)
      setStatus('unauthenticated')
      return
    }

    const currentManager = installManager(metadata)
    const restore = async () => {
      try {
        let restored = isAuthorizationResponse()
          ? await currentManager.signinRedirectCallback()
          : await currentManager.getUser()
        if (restored?.expired) {
          restored = await currentManager.signinSilent()
        }
        if (!restored) {
          await currentManager.removeUser()
          setStatus('unauthenticated')
          return
        }
        window.history.replaceState({}, document.title, window.location.pathname)
        setUser(authUser(restored))
        setStatus('authenticated')
      } catch (caught) {
        await currentManager.removeUser()
        window.history.replaceState({}, document.title, window.location.pathname)
        setUser(null)
        setError(caught instanceof Error ? caught.message : 'Sign-in could not be completed.')
        setStatus('error')
      }
    }
    void restore()
  }, [installManager])

  const signIn = useCallback(async (organization: string) => {
    setError('')
    setStatus('redirecting')
    try {
      const metadata = await discoverIdentityConnection(organization)
      window.sessionStorage.setItem(loginMetadataKey, JSON.stringify(metadata))
      const currentManager = installManager(metadata)
      await currentManager.signinRedirect()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Login is temporarily unavailable.')
      setStatus('error')
    }
  }, [installManager])

  const signOut = useCallback(async () => {
    const currentManager = manager.current
    const metadata = readMetadata()
    setUser(null)
    setError('')
    window.sessionStorage.removeItem(loginMetadataKey)
    if (!currentManager) {
      setStatus('unauthenticated')
      return
    }
    const currentUser = await currentManager.getUser()
    await currentManager.removeUser()
    await currentManager.signoutRedirect({
      id_token_hint: currentUser?.id_token,
      extraQueryParams: metadata
        ? {
            client_id: metadata.clientId,
            logout_uri: authRuntimeConfig.postLogoutRedirectUri,
          }
        : undefined,
    })
  }, [])

  const getAccessToken = useCallback(async () => {
    const currentManager = manager.current
    if (!currentManager) throw new Error('You are not signed in')
    let currentUser = await currentManager.getUser()
    if (!currentUser || currentUser.expired) {
      currentUser = await currentManager.signinSilent()
    }
    if (!currentUser?.access_token) throw new Error('No access token is available')
    return currentUser.access_token
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, error, signIn, signOut, getAccessToken }),
    [error, getAccessToken, signIn, signOut, status, user],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
