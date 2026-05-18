import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function seed() {
  const users = [
    { email: 'sp1@example.com', password: 'password', hasSpotify: true },
    { email: 'nsp1@example.com', password: 'password', hasSpotify: false }
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

    if (u.hasSpotify && userId) {
      const { error: spotifyError } = await supabase.from('spotify_tokens').upsert({
        user_id: userId,
        access_token: 'dummy-access-token',
        refresh_token: 'dummy-refresh-token',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        spotify_user_id: 'dummy-spotify-id'
      }, { onConflict: 'user_id' })
      
      if (spotifyError) {
         console.error('Error creating spotify token:', spotifyError.message)
      } else {
         console.log('Spotify token added for:', u.email)
      }
    }
  }
}

seed()