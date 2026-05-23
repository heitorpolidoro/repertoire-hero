import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/playlist';
const options = {
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000,
};

const clientPromise: Promise<MongoClient> = process.env.NODE_ENV === 'development'
  ? (() => {
      const globalWithMongo = global as typeof globalThis & {
        _mongoClientPromise?: Promise<MongoClient>;
      };

      if (!globalWithMongo._mongoClientPromise) {
        const client = new MongoClient(uri, options);
        globalWithMongo._mongoClientPromise = client.connect();
      }
      return globalWithMongo._mongoClientPromise;
    })()
  : new MongoClient(uri, options).connect();

export default clientPromise;
