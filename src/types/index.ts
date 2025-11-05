export interface Song {
  _id: string;
  title: string;
  artist: string;
  genre: string;
}

export interface Playlist {
  _id: string;
  title: string;
  songs: string[];
}
