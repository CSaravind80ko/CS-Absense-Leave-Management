import {
  AuthenticationDetails,
  CognitoUser,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthContext, type AuthContextValue, type AuthUser } from './auth-context'
import { userPool } from './config'

function sessionUser(user: CognitoUser, session: CognitoUserSession): AuthUser {
  const payload = session.getIdToken().decodePayload() as { email?: unknown }
  return {
    username: user.getUsername(),
    email: typeof payload.email === 'string' ? payload.email : undefined,
  }
}

function readSession(user: CognitoUser): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    user.getSession((error: Error | null, session: CognitoUserSession | null) => {
      if (error || !session) reject(error ?? new Error('No Cognito session is available'))
      else resolve(session)
    })
  })
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>(
    userPool ? 'loading' : 'misconfigured',
  )
  const [user, setUser] = useState<AuthUser | null>(null)
  const [sessionVersion, setSessionVersion] = useState(0)
  const cognitoUser = useRef<CognitoUser | null>(null)
  const challengedUser = useRef<CognitoUser | null>(null)
  const challengeAttributes = useRef<Record<string, string>>({})
  const session = useRef<CognitoUserSession | null>(null)
  const refreshTimer = useRef<number | undefined>(undefined)

  const clearTimer = useCallback(() => {
    if (refreshTimer.current !== undefined) window.clearTimeout(refreshTimer.current)
    refreshTimer.current = undefined
  }, [])

  const installSession = useCallback((nextUser: CognitoUser, nextSession: CognitoUserSession) => {
    cognitoUser.current = nextUser
    challengedUser.current = null
    challengeAttributes.current = {}
    session.current = nextSession
    setUser(sessionUser(nextUser, nextSession))
    setSessionVersion(version => version + 1)
    setStatus('authenticated')
  }, [])

  const refresh = useCallback(async (): Promise<CognitoUserSession> => {
    const currentUser = cognitoUser.current
    const currentSession = session.current
    if (!currentUser || !currentSession) throw new Error('You are not signed in')
    const refreshToken = currentSession.getRefreshToken()
    return new Promise((resolve, reject) => {
      currentUser.refreshSession(refreshToken, (error, refreshedSession) => {
        if (error || !refreshedSession) reject(error ?? new Error('Unable to refresh the session'))
        else {
          installSession(currentUser, refreshedSession)
          resolve(refreshedSession)
        }
      })
    })
  }, [installSession])

  useEffect(() => {
    if (status !== 'authenticated' || !session.current) return
    clearTimer()
    const expiresAt = session.current.getAccessToken().getExpiration() * 1000
    const delay = Math.max(1_000, expiresAt - Date.now() - 60_000)
    refreshTimer.current = window.setTimeout(() => {
      void refresh().catch(() => {
        cognitoUser.current?.signOut()
        cognitoUser.current = null
        session.current = null
        setUser(null)
        setStatus('unauthenticated')
      })
    }, delay)
    return clearTimer
  }, [clearTimer, refresh, sessionVersion, status])

  useEffect(() => {
    if (!userPool) return
    const currentUser = userPool.getCurrentUser()
    if (!currentUser) {
      setStatus('unauthenticated')
      return
    }
    readSession(currentUser)
      .then(currentSession => installSession(currentUser, currentSession))
      .catch(() => {
        currentUser.signOut()
        setStatus('unauthenticated')
      })
  }, [installSession])

  const signIn = useCallback(async (username: string, password: string) => {
    if (!userPool) throw new Error('Cognito is not configured')
    const nextUser = new CognitoUser({ Username: username.trim(), Pool: userPool })
    const details = new AuthenticationDetails({ Username: username.trim(), Password: password })
    const nextSession = await new Promise<CognitoUserSession | null>((resolve, reject) => {
      nextUser.authenticateUser(details, {
        onSuccess: resolve,
        onFailure: reject,
        newPasswordRequired: (userAttributes) => {
          const writableAttributes = Object.fromEntries(
            Object.entries(userAttributes)
              .filter(([name, value]) => name !== 'sub' && !name.endsWith('_verified') && typeof value === 'string'),
          ) as Record<string, string>
          challengedUser.current = nextUser
          challengeAttributes.current = writableAttributes
          setStatus('newPasswordRequired')
          resolve(null)
        },
      })
    })
    if (nextSession) installSession(nextUser, nextSession)
  }, [installSession])

  const completeNewPassword = useCallback(async (newPassword: string) => {
    const nextUser = challengedUser.current
    if (!nextUser) throw new Error('The password challenge has expired. Sign in again.')
    const nextSession = await new Promise<CognitoUserSession>((resolve, reject) => {
      nextUser.completeNewPasswordChallenge(newPassword, challengeAttributes.current, {
        onSuccess: resolve,
        onFailure: reject,
      })
    })
    installSession(nextUser, nextSession)
  }, [installSession])

  const signOut = useCallback(() => {
    clearTimer()
    cognitoUser.current?.signOut()
    challengedUser.current?.signOut()
    cognitoUser.current = null
    challengedUser.current = null
    challengeAttributes.current = {}
    session.current = null
    setUser(null)
    setStatus('unauthenticated')
  }, [clearTimer])

  const getAccessToken = useCallback(async () => {
    const currentSession = session.current
    if (!currentSession) throw new Error('You are not signed in')
    const expiresSoon = currentSession.getAccessToken().getExpiration() * 1000 <= Date.now() + 60_000
    const validSession = expiresSoon ? await refresh() : currentSession
    return validSession.getAccessToken().getJwtToken()
  }, [refresh])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn, completeNewPassword, signOut, getAccessToken }),
    [completeNewPassword, getAccessToken, signIn, signOut, status, user],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
