import { CheckCircle2, XCircle } from 'lucide-react';
import type { FinalResult } from '@/components/review/types';
import {
  formatNetChange,
  getVerdictBorderClass,
} from '@/components/review-dashboard/results-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ResultsSummaryTabProps {
  finalResult: FinalResult;
}

export function ResultsSummaryTab({ finalResult }: ResultsSummaryTabProps) {
  const verdictVariant = getVerdictBorderClass(finalResult.verdict);

  return (
    <div className="space-y-4">
      <Card className={verdictVariant}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Verdict</CardTitle>
            {finalResult.verdict === 'PASS' ? (
              <Badge className="gap-1 bg-green-500">
                <span suppressHydrationWarning>
                  <CheckCircle2 className="h-3 w-3" />
                </span>
                PASS
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <span suppressHydrationWarning>
                  <XCircle className="h-3 w-3" />
                </span>
                FAIL
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <MetricPill
              color="red"
              value={finalResult.statistics.p0_total}
              label="P0 (Blocking)"
            />
            <MetricPill
              color="yellow"
              value={finalResult.statistics.p1_total}
              label="P1 (Important)"
            />
            <MetricPill
              color="blue"
              value={finalResult.statistics.p2_total}
              label="P2 (Minor)"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Change Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatItem
              label="Files Changed"
              value={String(finalResult.statistics.files_changed)}
            />
            <StatItem
              label="Lines Added"
              value={`+${finalResult.statistics.lines_added}`}
              className="text-green-600"
            />
            <StatItem
              label="Lines Removed"
              value={`-${finalResult.statistics.lines_removed}`}
              className="text-red-600"
            />
            <StatItem
              label="Net Change"
              value={formatNetChange(
                finalResult.statistics.lines_added,
                finalResult.statistics.lines_removed,
              )}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricPill({
  color,
  value,
  label,
}: {
  color: 'red' | 'yellow' | 'blue';
  value: number;
  label: string;
}) {
  const palette = {
    red: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
    yellow:
      'bg-yellow-50 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-400',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
  };

  return (
    <div className={`rounded-lg p-4 text-center ${palette[color]}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function StatItem({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <div className={`text-2xl font-bold ${className ?? ''}`}>{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
