import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');
    
    if (!runId) {
      return NextResponse.json({ result: null, error: 'Missing runId' });
    }
    
    const finalPath = path.join(process.cwd(), '_ctx', 'review_runs', runId, 'final.json');
    
    if (!fs.existsSync(finalPath)) {
      return NextResponse.json({ result: null });
    }
    
    const finalData = JSON.parse(fs.readFileSync(finalPath, 'utf-8'));
    return NextResponse.json({ result: finalData });
  } catch (error) {
    return NextResponse.json({ result: null, error: 'Failed to read final data' });
  }
}
