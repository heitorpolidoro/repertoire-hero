import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

export async function getRequiredUserId(): Promise<string> {
  const session = await getSession()
  if (!session?.user?.id) throw new Error('Not authenticated')
  return session.user.id
}
