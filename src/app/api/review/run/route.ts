import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const runPath = path.join(process.cwd(), '_ctx', 'review_runs', 'current.json');
    
    if (!fs.existsSync(runPath)) {
      return NextResponse.json({ run: null });
    }
    
    const runData = JSON.parse(fs.readFileSync(runPath, 'utf-8'));
    return NextResponse.json({ run: runData });
  } catch (error) {
    return NextResponse.json({ run: null, error: 'Failed to read run data' });
  }
}
