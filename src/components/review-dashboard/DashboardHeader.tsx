import { GitBranch, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DashboardHeaderProps {
  onRefresh: () => void;
}

export function DashboardHeader({ onRefresh }: DashboardHeaderProps) {
  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary p-2">
              <span suppressHydrationWarning>
                <GitBranch className="h-6 w-6 text-primary-foreground" />
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">reviewctl</h1>
              <p className="text-sm text-muted-foreground">
                Code Review Orchestration Dashboard
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <span suppressHydrationWarning>
              <RefreshCw className="mr-2 h-4 w-4" />
            </span>
            Refresh
          </Button>
        </div>
      </div>
    </header>
  );
}
