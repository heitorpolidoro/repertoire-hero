const { MongoClient } = require('mongodb');

const uri = 'mongodb://localhost:27017/repertoire';

const songs = [
  { title: 'Bohemian Rhapsody', artist: 'Queen', genre: 'Rock' },
  { title: 'Hotel California', artist: 'Eagles', genre: 'Rock' },
  { title: 'Stairway to Heaven', artist: 'Led Zeppelin', genre: 'Rock' },
  { title: 'Sweet Child O Mine', artist: 'Guns N Roses', genre: 'Rock' },
  { title: 'The Girl from Ipanema', artist: 'Antonio Carlos Jobim', genre: 'Bossa Nova' },
  { title: 'Corcovado', artist: 'Antonio Carlos Jobim', genre: 'Bossa Nova' },
  { title: 'Wave', artist: 'Antonio Carlos Jobim', genre: 'Bossa Nova' },
  { title: 'Take Five', artist: 'Dave Brubeck', genre: 'Jazz' },
  { title: 'Blue Moon', artist: 'Billie Holiday', genre: 'Jazz' },
  { title: 'Summertime', artist: 'George Gershwin', genre: 'Jazz' },
  { title: 'Imagine', artist: 'John Lennon', genre: 'Pop' },
  { title: 'Yesterday', artist: 'The Beatles', genre: 'Pop' },
  { title: 'Hey Jude', artist: 'The Beatles', genre: 'Pop' },
  { title: 'Let It Be', artist: 'The Beatles', genre: 'Pop' },
  { title: 'Wonderwall', artist: 'Oasis', genre: 'Alternative Rock' }
];

async function seedDatabase() {
  try {
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('repertoire');

    // Clear existing data
    await db.collection('songs').deleteMany({});
    await db.collection('playlists').deleteMany({});
    console.log('🧹 Cleared existing data');

    // Insert songs
    const songsResult = await db.collection('songs').insertMany(songs);
    console.log(`🎵 Inserted ${songsResult.insertedCount} songs`);

    // Get inserted song IDs for playlists
    const insertedSongs = await db.collection('songs').find({}).toArray();
    const songIds = insertedSongs.map(song => song._id);

    // Create playlists with song references
    const playlists = [
      {
        title: 'Rock Classics',
        songs: songIds.filter((_, index) => [0, 1, 2, 3].includes(index))
      },
      {
        title: 'Bossa Nova Essentials',
        songs: songIds.filter((_, index) => [4, 5, 6].includes(index))
      },
      {
        title: 'Jazz Standards',
        songs: songIds.filter((_, index) => [7, 8, 9].includes(index))
      },
      {
        title: 'Beatles Collection',
        songs: songIds.filter((_, index) => [11, 12, 13].includes(index))
      },
      {
        title: 'Chill Mix',
        songs: songIds.filter((_, index) => [4, 8, 10, 11].includes(index))
      }
    ];

    const playlistsResult = await db.collection('playlists').insertMany(playlists);
    console.log(`🎧 Inserted ${playlistsResult.insertedCount} playlists`);

    await client.close();
    console.log('✅ Seed completed successfully!');
  } catch (error) {
    console.error('❌ Seed failed:', error);
  }
}

seedDatabase();
