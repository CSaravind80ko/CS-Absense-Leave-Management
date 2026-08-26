import { createContext } from 'react'

export interface AuthUser {
  username: string
  email?: string
}

export interface AuthContextValue {
  status: 'loading' | 'authenticated' | 'unauthenticated' | 'misconfigured' | 'newPasswordRequired'
  user: AuthUser | null
  signIn: (username: string, password: string) => Promise<void>
  completeNewPassword: (newPassword: string) => Promise<void>
  signOut: () => void
  getAccessToken: () => Promise<string>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
