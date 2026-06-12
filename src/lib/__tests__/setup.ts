import { vi } from 'vitest'
import { createAdminTestClient } from './test-helpers'

// Mock the Supabase client library globally for all tests
vi.mock('@supabase/supabase-js', () => {
  const mockClient = createAdminTestClient()
  return {
    createClient: () => mockClient,
  }
})
