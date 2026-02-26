import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { PROJECT_ROOT } from './constants.js';

export interface StackInfo {
  languages: string[];
  frameworks: string[];
  runtimes: string[];
  databases: string[];
  services: string[];
  buildTools: string[];
}

export interface SensitiveZone {
  zone: string;
  files: string[];
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

// Detect stack from project files
export async function detectStack(): Promise<StackInfo> {
  const stack: StackInfo = {
    languages: [],
    frameworks: [],
    runtimes: [],
    databases: [],
    services: [],
    buildTools: []
  };
  
  // Python detection
  const pythonFiles = await glob('**/*.py', { cwd: PROJECT_ROOT, ignore: ['node_modules/**', '.venv/**', 'venv/**'] });
  if (pythonFiles.length > 0) {
    stack.languages.push('Python');
    stack.runtimes.push('Python');
    
    if (fs.existsSync(path.join(PROJECT_ROOT, 'requirements.txt'))) {
      stack.buildTools.push('pip');
    }
    if (fs.existsSync(path.join(PROJECT_ROOT, 'pyproject.toml'))) {
      stack.buildTools.push('poetry/pdm');
    }
  }
  
  // TypeScript/JavaScript detection
  const tsFiles = await glob('**/*.ts', { cwd: PROJECT_ROOT, ignore: ['node_modules/**'] });
  const tsxFiles = await glob('**/*.tsx', { cwd: PROJECT_ROOT, ignore: ['node_modules/**'] });
  const jsFiles = await glob('**/*.js', { cwd: PROJECT_ROOT, ignore: ['node_modules/**'] });
  
  if (tsFiles.length > 0 || tsxFiles.length > 0) {
    stack.languages.push('TypeScript');
  }
  if (jsFiles.length > 0) {
    stack.languages.push('JavaScript');
  }
  
  if (tsFiles.length > 0 || tsxFiles.length > 0 || jsFiles.length > 0) {
    stack.runtimes.push('Node.js');
    
    if (fs.existsSync(path.join(PROJECT_ROOT, 'package.json'))) {
      stack.buildTools.push('npm/bun');
      
      const pkgJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
      const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
      
      // Framework detection
      if (deps['next']) stack.frameworks.push('Next.js');
      if (deps['react']) stack.frameworks.push('React');
      if (deps['vue']) stack.frameworks.push('Vue');
      if (deps['svelte']) stack.frameworks.push('Svelte');
      if (deps['express']) stack.frameworks.push('Express');
      if (deps['fastify']) stack.frameworks.push('Fastify');
      if (deps['nestjs'] || deps['@nestjs/core']) stack.frameworks.push('NestJS');
    }
  }
  
  // SQL detection
  const sqlFiles = await glob('**/*.sql', { cwd: PROJECT_ROOT });
  if (sqlFiles.length > 0) {
    stack.languages.push('SQL');
  }
  
  // Prisma detection
  if (fs.existsSync(path.join(PROJECT_ROOT, 'prisma/schema.prisma'))) {
    stack.databases.push('Prisma');
    stack.buildTools.push('Prisma CLI');
  }
  
  // Docker detection
  if (fs.existsSync(path.join(PROJECT_ROOT, 'Dockerfile'))) {
    stack.services.push('Docker');
  }
  if (fs.existsSync(path.join(PROJECT_ROOT, 'docker-compose.yml')) || 
      fs.existsSync(path.join(PROJECT_ROOT, 'docker-compose.yaml'))) {
    stack.services.push('Docker Compose');
  }
  
  // Remove duplicates and sort
  stack.languages = [...new Set(stack.languages)].sort();
  stack.frameworks = [...new Set(stack.frameworks)].sort();
  stack.runtimes = [...new Set(stack.runtimes)].sort();
  stack.databases = [...new Set(stack.databases)].sort();
  stack.services = [...new Set(stack.services)].sort();
  stack.buildTools = [...new Set(stack.buildTools)].sort();
  
  return stack;
}

// Detect sensitive zones from changed files
export function detectSensitiveZones(changedFiles: string[]): SensitiveZone[] {
  const zones: Map<string, { files: string[]; riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' }> = new Map();
  
  const patterns: Array<{ pattern: RegExp; zone: string; risk: 'HIGH' | 'MEDIUM' | 'LOW' }> = [
    { pattern: /auth|login|password|token|session|credential/i, zone: 'Authentication', risk: 'HIGH' },
    { pattern: /schema\.prisma|migration|\.sql$/i, zone: 'Database/Schema', risk: 'HIGH' },
    { pattern: /api|route|controller|endpoint/i, zone: 'API Endpoints', risk: 'MEDIUM' },
    { pattern: /\.env|config|settings/i, zone: 'Configuration', risk: 'MEDIUM' },
    { pattern: /middleware|guard|interceptor/i, zone: 'Security', risk: 'HIGH' },
    { pattern: /test|spec/i, zone: 'Tests', risk: 'LOW' },
    { pattern: /hook|util|lib/i, zone: 'Utilities', risk: 'LOW' },
  ];
  
  for (const file of changedFiles) {
    for (const { pattern, zone, risk } of patterns) {
      if (pattern.test(file)) {
        if (!zones.has(zone)) {
          zones.set(zone, { files: [], riskLevel: risk });
        }
        zones.get(zone)!.files.push(file);
        break; // Only match first pattern
      }
    }
  }
  
  return Array.from(zones.entries()).map(([zone, data]) => ({
    zone,
    files: data.files,
    riskLevel: data.riskLevel
  }));
}

// Determine third agent based on stack
export function determineThirdAgent(stack: StackInfo, sensitiveZones: SensitiveZone[]): string {
  // Python with API/DB changes
  if (stack.languages.includes('Python')) {
    const hasApiOrDb = sensitiveZones.some(z => 
      ['API Endpoints', 'Database/Schema'].includes(z.zone)
    );
    if (hasApiOrDb) {
      return 'silent-failure-hunter';
    }
  }
  
  // SQL changes detected
  const hasSqlChanges = sensitiveZones.some(z => z.zone === 'Database/Schema');
  if (hasSqlChanges || stack.languages.includes('SQL')) {
    return 'sql-safety-hunter';
  }
  
  // Default
  return 'pr-test-analyzer';
}

// Determine review type from stack and changed files
export function determineReviewType(
  stack: StackInfo,
  changedFiles: string[] = [],
  sensitiveZones: SensitiveZone[] = []
): string {
  const hasPythonInStack = stack.languages.includes('Python');

  const hasPythonChanges = changedFiles.some((f) => /\.py$/i.test(f));
  const hasSqlFileChanges = changedFiles.some((f) => /\.sql$/i.test(f));
  const hasSchemaOrMigrationChanges = changedFiles.some((f) =>
    /schema\.prisma|migration/i.test(f)
  );
  const hasDbSensitiveZone = sensitiveZones.some((z) => z.zone === 'Database/Schema');

  const hasPython = hasPythonInStack && (hasPythonChanges || changedFiles.length === 0);
  const hasSql = hasSqlFileChanges || hasSchemaOrMigrationChanges || hasDbSensitiveZone;

  if (hasPython && hasSql) return 'python+sql';
  if (hasPython) return 'python';
  if (hasSql) return 'sql';
  return 'general';
}
