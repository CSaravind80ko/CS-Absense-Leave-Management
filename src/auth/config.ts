export const authRuntimeConfig = {
  redirectUri:
    import.meta.env.VITE_AUTH_REDIRECT_URI?.trim() || window.location.origin,
  postLogoutRedirectUri:
    import.meta.env.VITE_AUTH_POST_LOGOUT_REDIRECT_URI?.trim() ||
    window.location.origin,
}

function isValidRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.hostname === 'localhost'
  } catch {
    return false
  }
}

export const missingAuthConfig = [
  !isValidRedirect(authRuntimeConfig.redirectUri) && 'VITE_AUTH_REDIRECT_URI',
  !isValidRedirect(authRuntimeConfig.postLogoutRedirectUri) &&
    'VITE_AUTH_POST_LOGOUT_REDIRECT_URI',
].filter((name): name is string => Boolean(name))
