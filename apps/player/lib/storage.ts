const KEYS = {
  TOKEN: 'player_token',
  DEVICE_ID: 'player_device_id',
  EMAIL: 'player_email',
  PASSWORD: 'player_password',
  USER: 'player_user',
}

const safeStorage = {
  getItem(key: string) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null
      return window.localStorage.getItem(key)
    } catch (e) {
      console.log('[storage] getItem error:', key, e)
      return null
    }
  },

  setItem(key: string, value: string) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return
      window.localStorage.setItem(key, value)
    } catch (e) {
      console.log('[storage] setItem error:', key, e)
    }
  },

  removeItem(key: string) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return
      window.localStorage.removeItem(key)
    } catch (e) {
      console.log('[storage] removeItem error:', key, e)
    }
  },
}

export const storage = {
  saveAuth: (
    token: string,
    email: string,
    password: string,
    user: { id: number; organization: string; organization_type: string }
  ) => {
    safeStorage.setItem(KEYS.TOKEN, token)
    safeStorage.setItem(KEYS.EMAIL, email)
    safeStorage.setItem(KEYS.PASSWORD, password)
    safeStorage.setItem(KEYS.USER, JSON.stringify(user))
  },

  getToken: () => safeStorage.getItem(KEYS.TOKEN),
  getEmail: () => safeStorage.getItem(KEYS.EMAIL),
  getPassword: () => safeStorage.getItem(KEYS.PASSWORD),

  getUser: () => {
    try {
      const raw = safeStorage.getItem(KEYS.USER)
      return raw ? JSON.parse(raw) : null
    } catch (e) {
      console.log('[storage] getUser parse error:', e)
      return null
    }
  },

  saveDeviceId: (id: string) => safeStorage.setItem(KEYS.DEVICE_ID, id),
  getDeviceId: () => safeStorage.getItem(KEYS.DEVICE_ID),

  clear: () => {
    Object.values(KEYS).forEach((k) => safeStorage.removeItem(k))
  },
}