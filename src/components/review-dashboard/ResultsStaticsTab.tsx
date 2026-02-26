import { Code } from 'lucide-react';
import type { FinalResult } from '@/components/review/types';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface ResultsStaticsTabProps {
  finalResult: FinalResult;
}

export function ResultsStaticsTab({ finalResult }: ResultsStaticsTabProps) {
  const entries = Object.entries(finalResult.statics);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Static Analysis</CardTitle>
        <CardDescription>Results from static analysis tools</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {entries.map(([tool, stats]) => (
            <div
              key={tool}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div className="flex items-center gap-3">
                <span suppressHydrationWarning>
                  <Code className="h-5 w-5 text-muted-foreground" />
                </span>
                <div>
                  <div className="font-medium">{tool}</div>
                  <div className="text-sm text-muted-foreground">
                    Status: {stats.status}
                  </div>
                </div>
              </div>
              <Badge variant={stats.issues > 0 ? 'secondary' : 'default'}>
                {stats.issues} issues
              </Badge>
            </div>
          ))}
          {entries.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No static analysis results
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
