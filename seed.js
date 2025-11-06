const { MongoClient } = require('mongodb');

const uri = 'mongodb://localhost:27017/repertoire';

// User data for seeding
const userData = {
  name: 'John Doe',
  email: 'john.doe@example.com',
  image: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face'
};

const songs = [
  { title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', duration: '5:55' },
  { title: 'Hotel California', artist: 'Eagles', album: 'Hotel California', duration: '6:30' },
  { title: 'Stairway to Heaven', artist: 'Led Zeppelin', album: 'Led Zeppelin IV', duration: '8:02' },
  { title: 'Sweet Child O Mine', artist: 'Guns N Roses', album: 'Appetite for Destruction', duration: '5:03' },
  { title: 'The Girl from Ipanema', artist: 'Antonio Carlos Jobim', album: 'Getz/Gilberto', duration: '5:06' },
  { title: 'Corcovado', artist: 'Antonio Carlos Jobim', album: 'The Composer of Desafinado', duration: '4:12' },
  { title: 'Wave', artist: 'Antonio Carlos Jobim', album: 'Wave', duration: '4:35' },
  { title: 'Take Five', artist: 'Dave Brubeck', album: 'Time Out', duration: '5:24' },
  { title: 'Blue Moon', artist: 'Billie Holiday', album: 'Billie Holiday Sings', duration: '3:22' },
  { title: 'Summertime', artist: 'George Gershwin', album: 'Porgy and Bess', duration: '4:18' },
  { title: 'Imagine', artist: 'John Lennon', album: 'Imagine', duration: '3:07' },
  { title: 'Yesterday', artist: 'The Beatles', album: 'Help!', duration: '2:05' },
  { title: 'Hey Jude', artist: 'The Beatles', album: 'Hey Jude', duration: '7:11' },
  { title: 'Let It Be', artist: 'The Beatles', album: 'Let It Be', duration: '3:50' },
  { title: 'Wonderwall', artist: 'Oasis', album: '(What\'s the Story) Morning Glory?', duration: '4:18' }
];

async function seedDatabase() {
  try {
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('repertoire');

    // Create or update user
    await db.collection('users').updateOne(
      { email: userData.email },
      {
        $set: {
          ...userData,
          emailVerified: null,
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
    console.log('👤 User created/updated');

    // Clear existing data
    await db.collection('songs').deleteMany({});
    await db.collection('playlists').deleteMany({ userEmail: userData.email });
    console.log('🧹 Cleared existing data');

    // Insert songs without user association
    const songsWithTimestamp = songs.map(song => ({
      ...song,
      createdAt: new Date()
    }));

    const songsResult = await db.collection('songs').insertMany(songsWithTimestamp);
    console.log(`🎵 Inserted ${songsResult.insertedCount} songs`);

    // Get inserted song IDs for playlists
    const insertedSongs = await db.collection('songs').find({}).toArray();
    const songIds = insertedSongs.map(song => song._id);

    // Create playlists with song references and user association
    const playlists = [
      {
        title: 'Rock Classics',
        songs: songIds.filter((_, index) => [0, 1, 2, 3].includes(index)),
        userEmail: userData.email,
        createdAt: new Date()
      },
      {
        title: 'Bossa Nova Essentials',
        songs: songIds.filter((_, index) => [4, 5, 6].includes(index)),
        userEmail: userData.email,
        createdAt: new Date()
      },
      {
        title: 'Jazz Standards',
        songs: songIds.filter((_, index) => [7, 8, 9].includes(index)),
        userEmail: userData.email,
        createdAt: new Date()
      },
      {
        title: 'Beatles Collection',
        songs: songIds.filter((_, index) => [11, 12, 13].includes(index)),
        userEmail: userData.email,
        createdAt: new Date()
      },
      {
        title: 'Chill Mix',
        songs: songIds.filter((_, index) => [4, 8, 10, 11].includes(index)),
        userEmail: userData.email,
        createdAt: new Date()
      }
    ];

    const playlistsResult = await db.collection('playlists').insertMany(playlists);
    console.log(`🎧 Inserted ${playlistsResult.insertedCount} playlists`);

    await client.close();
    console.log('✅ Seed completed successfully!');
    console.log(`📧 User email: ${userData.email}`);
  } catch (error) {
    console.error('❌ Seed failed:', error);
  }
}

seedDatabase();
