import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import clientPromise from '@/lib/mongodb';

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query) {
      return NextResponse.json([]);
    }

    const client = await clientPromise;
    const db = client.db('repertoire');

    const songs = await db.collection('songs').find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { artist: { $regex: query, $options: 'i' } },
        { album: { $regex: query, $options: 'i' } }
      ]
    }).toArray();

    return NextResponse.json(songs);
  } catch (error) {
    console.error('Database connection error:', error);
    return NextResponse.json({
      error: 'Database unavailable. Please check if MongoDB is running.'
    }, { status: 503 });
  }
}
