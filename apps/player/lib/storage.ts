const KEYS = {
  TOKEN: 'player_token',
  DEVICE_ID: 'player_device_id',
  EMAIL: 'player_email',
  PASSWORD: 'player_password',
  USER: 'player_user',
}

export const storage = {
  saveAuth: (
    token: string,
    email: string,
    password: string,
    user: { id: number; organization: string; organization_type: string }
  ) => {
    localStorage.setItem(KEYS.TOKEN, token)
    localStorage.setItem(KEYS.EMAIL, email)
    localStorage.setItem(KEYS.PASSWORD, password)
    localStorage.setItem(KEYS.USER, JSON.stringify(user))
  },

  getToken: () => localStorage.getItem(KEYS.TOKEN),
  getEmail: () => localStorage.getItem(KEYS.EMAIL),
  getPassword: () => localStorage.getItem(KEYS.PASSWORD),
  getUser: () => {
    const raw = localStorage.getItem(KEYS.USER)
    return raw ? JSON.parse(raw) : null
  },

  saveDeviceId: (id: string) => localStorage.setItem(KEYS.DEVICE_ID, id),
  getDeviceId: () => localStorage.getItem(KEYS.DEVICE_ID),

  clear: () => Object.values(KEYS).forEach((k) => localStorage.removeItem(k)),
}