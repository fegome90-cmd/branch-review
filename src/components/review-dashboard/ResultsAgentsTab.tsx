import { Bug, Code, Database, Shield, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FinalResult } from '@/components/review/types';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface ResultsAgentsTabProps {
  finalResult: FinalResult;
}

const agentIcons: Record<string, ReactNode> = {
  'code-reviewer': <Code className="h-4 w-4" />,
  'code-simplifier': <Zap className="h-4 w-4" />,
  'silent-failure-hunter': <Bug className="h-4 w-4" />,
  'sql-safety-hunter': <Database className="h-4 w-4" />,
  'pr-test-analyzer': <Shield className="h-4 w-4" />,
};

export function ResultsAgentsTab({ finalResult }: ResultsAgentsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Agent Results</CardTitle>
        <CardDescription>Findings by review agent</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {Object.entries(finalResult.agents).map(([agent, stats]) => (
            <div
              key={agent}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div className="flex items-center gap-3">
                <span suppressHydrationWarning>
                  {agentIcons[agent] || <Code className="h-4 w-4" />}
                </span>
                <div>
                  <div className="font-medium">{agent}</div>
                  <div className="text-sm text-muted-foreground">
                    Status: {stats.status}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {stats.p0 > 0 && (
                  <Badge variant="destructive">{stats.p0} P0</Badge>
                )}
                {stats.p1 > 0 && (
                  <Badge variant="secondary">{stats.p1} P1</Badge>
                )}
                {stats.p2 > 0 && <Badge variant="outline">{stats.p2} P2</Badge>}
                {stats.p0 === 0 && stats.p1 === 0 && stats.p2 === 0 && (
                  <Badge>Clean</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
