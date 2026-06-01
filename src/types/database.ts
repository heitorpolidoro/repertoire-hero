export type SongStatus =
  | "unknown"
  | "learning"
  | "practicing"
  | "polishing"
  | "mastered";

export interface SongLink {
  label: string;
  url: string;
}

export interface GlobalSong {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  standard_key: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  links: SongLink[];
  created_at: string;
}

export interface Repertoire {
  id: string;
  user_id: string | null;
  band_id: string | null;
  song_id: string;
  personal_key: string | null;
  status: SongStatus;
  tags: string[];
  last_practiced: string | null;
  song?: GlobalSong;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  instruments: string[];
  primary_instrument: string | null;
}

export interface SpotifyToken {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  spotify_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Playlist {
  id: string;
  user_id: string | null;
  band_id: string | null;
  name: string;
  description: string | null;
  cover_url: string | null;
  spotify_playlist_id: string | null;
  sync_with_spotify: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
  songs?: PlaylistSong[];
  band?: { id: string; name: string } | null;
}

export interface Band {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  created_by: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
  members?: BandMember[];
}

export interface BandMember {
  id: string;
  band_id: string;
  user_id: string;
  role: "admin" | "member";
  joined_at: string;
  profile?: Pick<
    Profile,
    "id" | "full_name" | "avatar_url" | "email" | "primary_instrument"
  >;
}

export interface PlaylistSong {
  id: string;
  playlist_id: string;
  song_id: string;
  position: number;
  song?: GlobalSong;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  total_tracks: number;
  owner: string;
}
