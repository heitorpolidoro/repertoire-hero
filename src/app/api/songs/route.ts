import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import clientPromise from '@/lib/mongodb';

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await clientPromise;
    const db = client.db('repertoire');
    const songs = await db.collection('songs').find().toArray();

    return NextResponse.json(songs);
  } catch (error) {
    console.error('Database connection error:', error);
    return NextResponse.json({
      error: 'Database unavailable. Please check if MongoDB is running.'
    }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await clientPromise;
    const db = client.db('repertoire');
    const body = await request.json();

    const songWithTimestamp = {
      ...body,
      createdAt: new Date()
    };

    const result = await db.collection('songs').insertOne(songWithTimestamp);

    return NextResponse.json({ id: result.insertedId });
  } catch (error) {
    console.error('Database connection error:', error);
    return NextResponse.json({
      error: 'Database unavailable. Please check if MongoDB is running.'
    }, { status: 503 });
  }
}
