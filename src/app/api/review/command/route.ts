import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { command, args = {} } = body;
    
    // Build command
    let cmd = `bun ${path.join(process.cwd(), 'mini-services', 'reviewctl', 'src', 'index.ts')} ${command}`;
    
    // Add args
    for (const [key, value] of Object.entries(args)) {
      if (value === 'true') {
        cmd += ` --${key}`;
      } else {
        cmd += ` --${key} ${value}`;
      }
    }
    
    // Execute
    try {
      const output = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 120000, // 2 minutes
        cwd: process.cwd()
      });
      
      return NextResponse.json({ 
        success: true, 
        output: output || `${command} completed successfully` 
      });
    } catch (error: any) {
      // Command may have non-zero exit but still have useful output
      const output = error.stdout || error.stderr || error.message;
      return NextResponse.json({ 
        success: false, 
        output: output || `${command} failed` 
      });
    }
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      output: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
  }
}
