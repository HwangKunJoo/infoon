'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authApi, deviceApi, getDeviceHardwareInfo } from '@/lib/api'
import { storage } from '@/lib/storage'
import { User } from '@/types/player'

export default function PlayerLogin() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const autoLogin = async () => {
      try {
        const savedEmail = storage.getEmail()
        const savedPassword = storage.getPassword()
        if (!savedEmail || !savedPassword) return

        const res = await authApi.login(savedEmail, savedPassword)
        if (!res?.data?.token) return

        const { token, user } = res.data
        storage.saveAuth(token, savedEmail, savedPassword, user)
        await registerAndRedirect(token, user)
      } catch {
        storage.clear()
      } finally {
        setRestoring(false)
      }
    }

    autoLogin()
  }, [])

  const registerAndRedirect = async (token: string, user: User) => {
    const savedDeviceId = storage.getDeviceId()

    if (savedDeviceId) {
      router.replace(`/player/play?deviceId=${savedDeviceId}`)
      return
    }

    const { modelId, modelName } = getDeviceHardwareInfo()
    const orientation = window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'

    const res = await deviceApi.register(token, {
      modelId,
      modelName,
      orientation,
      organization: user.organization,
      organization_type: user.organization_type,
      userId: user.id,
    })

    const deviceId = String(res.data.id)
    storage.saveDeviceId(deviceId)
    router.replace(`/player/play?deviceId=${deviceId}`)
  }

  const handleSubmit = async () => {
    if (loading || restoring) return
    setError(null)

    if (!email.trim()) return setError('이메일을 입력해주세요')
    if (!password) return setError('비밀번호를 입력해주세요')

    setLoading(true)
    try {
      const res = await authApi.login(email.trim(), password)
      if (!res?.data?.token) {
        setError('이메일 또는 비밀번호를 확인해주세요')
        return
      }

      const { token, user } = res.data
      storage.saveAuth(token, email.trim(), password, user)
      await registerAndRedirect(token, user)
    } catch {
      setError('로그인 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  if (restoring) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-neutral-50">
        <p className="text-gray-500 text-lg">자동 로그인 시도 중...</p>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-neutral-50">
      <div className="bg-white rounded-2xl shadow-md p-10 w-full max-w-md">
        <h1 className="text-3xl font-bold text-gray-900">로그인</h1>
        <p className="text-sm text-gray-500 mt-1 mb-8">계정에 접속해 서비스를 시작하세요</p>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">이메일</label>
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
            <label className="text-sm font-medium text-gray-700 mb-1 block">비밀번호</label>
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
        </div>
      </div>
    </div>
  )
}