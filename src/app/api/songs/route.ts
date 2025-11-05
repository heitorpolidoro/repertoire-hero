import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db('repertoire');
    const songs = await db.collection('songs').find({}).toArray();

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
    const client = await clientPromise;
    const db = client.db('repertoire');
    const body = await request.json();

    const result = await db.collection('songs').insertOne(body);

    return NextResponse.json({ id: result.insertedId });
  } catch (error) {
    console.error('Database connection error:', error);
    return NextResponse.json({
      error: 'Database unavailable. Please check if MongoDB is running.'
    }, { status: 503 });
  }
}
