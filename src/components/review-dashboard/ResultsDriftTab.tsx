import type { ReactNode } from 'react';
import type { FinalResult } from '@/components/review/types';
import { getDriftBadgeVariant } from '@/components/review-dashboard/results-state';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface ResultsDriftTabProps {
  finalResult: FinalResult;
}

export function ResultsDriftTab({ finalResult }: ResultsDriftTabProps) {
  const statusVariant = getDriftBadgeVariant(finalResult.drift.status);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Drift Analysis</CardTitle>
        <CardDescription>Plan vs Implementation comparison</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <InfoRow
            label="Status"
            value={
              <Badge variant={statusVariant}>{finalResult.drift.status}</Badge>
            }
          />
          <InfoRow
            label="Plan Source"
            value={
              <code className="font-mono text-sm">
                {finalResult.drift.plan_source || 'None'}
              </code>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <span className="font-medium">{label}</span>
      {value}
    </div>
  );
}
