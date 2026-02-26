import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  GitBranch,
  Play,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { RunInfo } from '@/components/review/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface RunStatusCardProps {
  run: RunInfo | null;
}

function getStatusBadge(status: string) {
  const variants: Record<
    string,
    { variant: 'default' | 'destructive' | 'secondary'; icon: ReactNode }
  > = {
    pending: { variant: 'secondary', icon: <RefreshCw className="h-3 w-3" /> },
    exploring: { variant: 'secondary', icon: <Search className="h-3 w-3" /> },
    planning: { variant: 'secondary', icon: <FileText className="h-3 w-3" /> },
    running: { variant: 'default', icon: <Play className="h-3 w-3" /> },
    verdict: {
      variant: 'default',
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    completed: {
      variant: 'default',
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    failed: { variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
  };

  const config = variants[status] || variants.pending;
  return (
    <Badge variant={config.variant} className="gap-1">
      <span suppressHydrationWarning>{config.icon}</span>
      {status}
    </Badge>
  );
}

function getDriftVariant(status: string) {
  if (status === 'ALIGNED') return 'default';
  if (status === 'DRIFT_RISK') return 'secondary';
  return 'destructive';
}

export function RunStatusCard({ run }: RunStatusCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span suppressHydrationWarning>
            <GitBranch className="h-5 w-5" />
          </span>
          Current Run
        </CardTitle>
      </CardHeader>
      <CardContent>
        {run ? (
          <div className="space-y-3">
            <Row
              label="Run ID"
              value={<code className="font-mono text-sm">{run.run_id}</code>}
            />
            <Row
              label="Branch"
              value={<code className="font-mono text-sm">{run.branch}</code>}
            />
            <Row label="Status" value={getStatusBadge(run.status)} />
            <Row
              label="Plan"
              value={
                <Badge
                  variant={
                    run.plan_status === 'FOUND' ? 'default' : 'secondary'
                  }
                >
                  {run.plan_status}
                </Badge>
              }
            />
            {run.drift_status && (
              <Row
                label="Drift"
                value={
                  <Badge variant={getDriftVariant(run.drift_status)}>
                    {run.drift_status}
                  </Badge>
                }
              />
            )}
          </div>
        ) : (
          <div className="py-4 text-center text-muted-foreground">
            <span suppressHydrationWarning>
              <GitBranch className="mx-auto mb-2 h-8 w-8 opacity-50" />
            </span>
            <p>No active review run</p>
            <p className="text-sm">Initialize a new run to get started</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      {value}
    </div>
  );
}
