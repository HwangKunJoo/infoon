'use client'

import { useEffect, useState } from 'react'
import { storage } from '@/lib/storage'

export default function PlayerLogin() {
  const [text, setText] = useState('init')

  useEffect(() => {
    try {
      const email = storage.getEmail()
      setText(`effect-ran / email: ${email ?? 'none'}`)
    } catch (e) {
      setText('storage-error')
      console.log('storage error', e)
    }
  }, [])

  return (
    <div style={{ fontSize: '40px', padding: '40px' }}>
      {text}
    </div>
  )
}