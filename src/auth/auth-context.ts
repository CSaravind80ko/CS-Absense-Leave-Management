import { createContext } from 'react'

export interface AuthUser {
  subject: string
  email?: string
}

export interface AuthContextValue {
  status: 'loading' | 'redirecting' | 'authenticated' | 'unauthenticated' | 'misconfigured' | 'error'
  user: AuthUser | null
  error: string
  signIn: (organization: string) => Promise<void>
  signOut: () => Promise<void>
  getAccessToken: () => Promise<string>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
