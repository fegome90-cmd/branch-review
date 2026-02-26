import { FileText } from 'lucide-react';
import type { FinalResult } from '@/components/review/types';
import { ResultsAgentsTab } from '@/components/review-dashboard/ResultsAgentsTab';
import { ResultsDriftTab } from '@/components/review-dashboard/ResultsDriftTab';
import { ResultsStaticsTab } from '@/components/review-dashboard/ResultsStaticsTab';
import { ResultsSummaryTab } from '@/components/review-dashboard/ResultsSummaryTab';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ResultsTabsProps {
  finalResult: FinalResult | null;
}

export function ResultsTabs({ finalResult }: ResultsTabsProps) {
  if (!finalResult) {
    return (
      <Card className="flex h-96 items-center justify-center">
        <div className="text-center text-muted-foreground">
          <span suppressHydrationWarning>
            <FileText className="mx-auto mb-4 h-12 w-12 opacity-50" />
          </span>
          <p className="text-lg font-medium">No Review Results</p>
          <p className="text-sm">Run a complete review to see results here</p>
        </div>
      </Card>
    );
  }

  return (
    <Tabs defaultValue="summary">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="agents">Agents</TabsTrigger>
        <TabsTrigger value="statics">Statics</TabsTrigger>
        <TabsTrigger value="drift">Drift</TabsTrigger>
      </TabsList>

      <TabsContent value="summary">
        <ResultsSummaryTab finalResult={finalResult} />
      </TabsContent>
      <TabsContent value="agents">
        <ResultsAgentsTab finalResult={finalResult} />
      </TabsContent>
      <TabsContent value="statics">
        <ResultsStaticsTab finalResult={finalResult} />
      </TabsContent>
      <TabsContent value="drift">
        <ResultsDriftTab finalResult={finalResult} />
      </TabsContent>
    </Tabs>
  );
}
