const BASE_URL = 'https://api.onldo.life/api'

const fetcher = async (url: string, token?: string, options?: RequestInit) => {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })

  if (!res.ok) throw new Error(`HTTP error: ${res.status}`)
  return res.json()
}

export const authApi = {
  login: (email: string, password: string) =>
    fetcher('/digital_board/auth/login', undefined, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
}

export const deviceApi = {
  get: (token: string) => fetcher('/digital_board/devices', token),

  register: (
    token: string,
    params: {
      modelId: string
      modelName: string
      orientation: string
      organization: string
      organization_type: string
      userId: number
    }
  ) =>
    fetcher('/digital_board/devices/register', token, {
      method: 'POST',
      body: JSON.stringify({
        model_id: params.modelId,
        device_model_name: params.modelName,
        orientation: params.orientation,
        user_id: params.userId,
        organization: params.organization,
        organization_type: params.organization_type,
      }),
    }),
}

export const getDeviceHardwareInfo = (): { modelId: string; modelName: string } => {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof (window as any).webapis !== 'undefined' &&
      (window as any).webapis?.productinfo?.getModelCode
    ) {
      const modelCode = (window as any).webapis.productinfo.getModelCode()
      return { modelId: modelCode, modelName: modelCode }
    }
  } catch (e) {
    console.log('[api] getDeviceHardwareInfo error:', e)
  }

  return { modelId: 'web', modelName: 'web_player' }
}