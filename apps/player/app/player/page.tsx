'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authApi, deviceApi, getDeviceHardwareInfo } from '@/lib/api'
import { storage } from '@/lib/storage'
import { User } from '@/types/player'

type DebugState =
  | 'init'
  | 'checking-storage'
  | 'no-saved-credentials'
  | 'logging-in'
  | 'login-success'
  | 'registering-device'
  | 'redirecting-saved-device'
  | 'redirecting-new-device'
  | 'show-login'
  | 'error'

const AUTO_LOGIN_TIMEOUT = 5000
const DEVICE_REGISTER_TIMEOUT = 5000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}_TIMEOUT`))
    }, ms)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

export default function PlayerLogin() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [debugState, setDebugState] = useState<DebugState>('init')
  const [debugLogs, setDebugLogs] = useState<string[]>([])

  const addLog = (message: string) => {
    console.log(`[PlayerLogin] ${message}`)
    setDebugLogs((prev) => [...prev.slice(-7), message])
  }

  const isInvalidStoredValue = (value: string | null | undefined) => {
    return !value || value === 'undefined' || value === 'null'
  }

  const registerAndRedirect = async (token: string, user: User) => {
    addLog('registerAndRedirect start')

    const savedDeviceId = storage.getDeviceId()
    addLog(`savedDeviceId: ${savedDeviceId || '(none)'}`)

    if (savedDeviceId && savedDeviceId !== 'undefined' && savedDeviceId !== 'null') {
      setDebugState('redirecting-saved-device')
      addLog(`redirecting with saved deviceId: ${savedDeviceId}`)
      router.replace(`/player/play?deviceId=${savedDeviceId}`)
      return
    }

    setDebugState('registering-device')
    addLog('getting hardware info')

    const { modelId, modelName } = getDeviceHardwareInfo()
    const orientation =
      window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'

    addLog(
      `device info - modelId: ${modelId}, modelName: ${modelName}, orientation: ${orientation}`
    )

    addLog('device register request start')

    const res = await withTimeout(
      deviceApi.register(token, {
        modelId,
        modelName,
        orientation,
        organization: user.organization,
        organization_type: user.organization_type,
        userId: user.id,
      }),
      DEVICE_REGISTER_TIMEOUT,
      'DEVICE_REGISTER'
    )

    addLog('device register request success')

    const deviceId = String(res.data.id)
    storage.saveDeviceId(deviceId)
    addLog(`saved new deviceId: ${deviceId}`)

    setDebugState('redirecting-new-device')
    router.replace(`/player/play?deviceId=${deviceId}`)
  }

  useEffect(() => {
    const autoLogin = async () => {
      try {
        setDebugState('checking-storage')
        addLog('auto login start')

        const savedEmail = storage.getEmail()
        const savedPassword = storage.getPassword()

        addLog(`savedEmail: ${savedEmail || '(none)'}`)
        addLog(`savedPassword exists: ${!!savedPassword}`)

        if (isInvalidStoredValue(savedEmail) || isInvalidStoredValue(savedPassword)) {
          addLog('no valid saved credentials, clearing storage')
          storage.clear()
          setDebugState('no-saved-credentials')
          return
        }

        setDebugState('logging-in')
        addLog('auto login request start')

        const res = await withTimeout(
          authApi.login(savedEmail!, savedPassword!),
          AUTO_LOGIN_TIMEOUT,
          'AUTO_LOGIN'
        )

        addLog('auto login request success')

        if (!res?.data?.token) {
          addLog('no token returned, clearing storage')
          storage.clear()
          setError('저장된 로그인 정보가 유효하지 않습니다. 다시 로그인해주세요.')
          setDebugState('show-login')
          return
        }

        const { token, user } = res.data
        addLog(`login success - userId: ${user?.id}`)

        storage.saveAuth(token, savedEmail!, savedPassword!, user)
        setDebugState('login-success')

        await registerAndRedirect(token, user)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'UNKNOWN_ERROR'
        addLog(`auto login error: ${message}`)
        console.error('[PlayerLogin] autoLogin error:', e)

        storage.clear()

        if (message === 'AUTO_LOGIN_TIMEOUT') {
          setError('자동 로그인 요청이 지연되고 있습니다. 다시 로그인해주세요.')
        } else if (message === 'DEVICE_REGISTER_TIMEOUT') {
          setError('기기 등록 요청이 지연되고 있습니다. 다시 시도해주세요.')
        } else {
          setError('자동 로그인 중 오류가 발생했습니다. 다시 로그인해주세요.')
        }

        setDebugState('error')
      } finally {
        addLog('auto login finally -> restoring false')
        setRestoring(false)
      }
    }

    autoLogin()
  }, [])

  const handleSubmit = async () => {
    if (loading || restoring) return

    setError(null)
    addLog('manual login start')

    if (!email.trim()) {
      setError('이메일을 입력해주세요')
      return
    }

    if (!password) {
      setError('비밀번호를 입력해주세요')
      return
    }

    setLoading(true)

    try {
      addLog(`manual login request start: ${email.trim()}`)

      const res = await withTimeout(
        authApi.login(email.trim(), password),
        AUTO_LOGIN_TIMEOUT,
        'MANUAL_LOGIN'
      )

      addLog('manual login request success')

      if (!res?.data?.token) {
        setError('이메일 또는 비밀번호를 확인해주세요')
        addLog('manual login failed: no token')
        return
      }

      const { token, user } = res.data
      storage.saveAuth(token, email.trim(), password, user)
      addLog(`manual login success - userId: ${user?.id}`)

      await registerAndRedirect(token, user)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'UNKNOWN_ERROR'
      addLog(`manual login error: ${message}`)
      console.error('[PlayerLogin] handleSubmit error:', e)

      if (message === 'MANUAL_LOGIN_TIMEOUT') {
        setError('로그인 요청이 지연되고 있습니다. 다시 시도해주세요.')
      } else if (message === 'DEVICE_REGISTER_TIMEOUT') {
        setError('기기 등록 요청이 지연되고 있습니다. 다시 시도해주세요.')
      } else {
        setError('로그인 중 오류가 발생했습니다')
      }
    } finally {
      addLog('manual login finally')
      setLoading(false)
    }
  }

  if (restoring) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-neutral-50 p-8">
        <p className="text-gray-700 text-2xl font-semibold mb-4">
          자동 로그인 시도 중...
        </p>
        <p className="text-gray-500 text-base mb-6">상태: {debugState}</p>

        <div className="w-full max-w-3xl bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-800 mb-3">디버그 로그</p>
          <div className="space-y-2">
            {debugLogs.map((log, idx) => (
              <p key={`${idx}-${log}`} className="text-sm text-gray-600 break-all">
                {log}
              </p>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-neutral-50 p-8">
      <div className="bg-white rounded-2xl shadow-md p-10 w-full max-w-md">
        <h1 className="text-3xl font-bold text-gray-900">로그인</h1>
        <p className="text-sm text-gray-500 mt-1 mb-3">
          계정에 접속해 서비스를 시작하세요
        </p>
        <p className="text-xs text-gray-400 mb-8">현재 상태: {debugState}</p>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              이메일
            </label>
            <input
              type="email"
              placeholder="example@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              disabled={loading}
              className="w-full h-12 px-4 border border-gray-300 rounded-lg text-sm outline-none focus:border-orange-400 transition"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              비밀번호
            </label>
            <input
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              disabled={loading}
              className="w-full h-12 px-4 border border-gray-300 rounded-lg text-sm outline-none focus:border-orange-400 transition"
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full h-14 rounded-xl bg-orange-400 text-white font-bold text-base mt-2 disabled:opacity-75 transition"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>

          <button
            type="button"
            onClick={() => {
              storage.clear()
              setError('저장된 로그인 정보를 초기화했습니다. 다시 로그인해주세요.')
              setDebugState('show-login')
              addLog('storage cleared manually')
            }}
            className="w-full h-12 rounded-xl bg-gray-100 text-gray-700 font-medium text-sm"
          >
            저장 정보 초기화
          </button>
        </div>

        <div className="mt-8 border-t pt-4">
          <p className="text-xs font-bold text-gray-700 mb-2">최근 로그</p>
          <div className="space-y-1">
            {debugLogs.map((log, idx) => (
              <p key={`${idx}-${log}`} className="text-xs text-gray-500 break-all">
                {log}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}