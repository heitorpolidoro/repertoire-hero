export interface Song {
  _id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  createdAt: Date;
}

export interface Playlist {
  _id: string;
  title: string;
  songs: string[];
  userEmail: string;
  createdAt: Date;
}
