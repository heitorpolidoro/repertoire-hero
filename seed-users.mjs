import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function seed() {
  const users = [
    { email: 'com.spotify@exemple.com', password: 'password', hasSpotify: true },
    { email: 'sem_spotify@exemple.com', password: 'password', hasSpotify: false }
  ]

  for (const u of users) {
    const { data: { user }, error } = await supabase.auth.signUp({
      email: u.email,
      password: u.password,
      options: {
        data: { full_name: u.email.split('@')[0] }
      }
    })

    // If already registered, sign in to get the user id
    let userId = user?.id
    if (error && error.message.includes('already registered')) {
        const { data: signinData } = await supabase.auth.signInWithPassword({ email: u.email, password: u.password })
        userId = signinData.user?.id
        console.log('User already existed:', u.email, userId)
    } else if (error) {
       console.error('Error creating user:', u.email, error.message)
       continue
    } else {
       console.log('User created:', u.email, userId)
    }
  }
}

seed()