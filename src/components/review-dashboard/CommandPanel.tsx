import {
  AlertTriangle,
  FileText,
  GitMerge,
  Play,
  Search,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { ReviewCommand, RunInfo } from '@/components/review/types';
import { getCommandPanelState } from '@/components/review-dashboard/command-panel-state';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

interface CommandPanelProps {
  reviewToken: string;
  runningCommand: string | null;
  currentRun: RunInfo | null;
  onTokenChange: (token: string) => void;
  onRunCommand: (command: ReviewCommand, args?: Record<string, string>) => void;
}

export function CommandPanel({
  reviewToken,
  runningCommand,
  currentRun,
  onTokenChange,
  onRunCommand,
}: CommandPanelProps) {
  const { hasToken, canRun, requiresRun, disabledReason } =
    getCommandPanelState(reviewToken, runningCommand, currentRun);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Commands</CardTitle>
        <CardDescription>Execute reviewctl commands</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3" aria-busy={runningCommand !== null}>
        <div className="space-y-2">
          <label
            htmlFor="review-token"
            className="text-sm text-muted-foreground"
          >
            Review API Token
          </label>
          <Input
            id="review-token"
            type="password"
            placeholder="Enter REVIEW_API_TOKEN"
            value={reviewToken}
            onChange={(event) => onTokenChange(event.target.value)}
          />
          {!hasToken && (
            <p className="text-xs text-muted-foreground">
              Required to execute commands.
            </p>
          )}
        </div>

        {disabledReason && (
          <p
            id="command-disabled-reason"
            className="text-xs text-muted-foreground"
          >
            {disabledReason}
          </p>
        )}

        <ActionButton
          label="init --create"
          icon={<Play className="h-4 w-4" />}
          disabled={!canRun}
          ariaDescribedBy={
            disabledReason ? 'command-disabled-reason' : undefined
          }
          onClick={() => onRunCommand('init', { create: 'true' })}
        />
        <ActionButton
          label="explore context"
          icon={<Search className="h-4 w-4" />}
          disabled={!requiresRun}
          ariaDescribedBy={
            disabledReason ? 'command-disabled-reason' : undefined
          }
          onClick={() => onRunCommand('explore', { type: 'context' })}
        />
        <ActionButton
          label="explore diff"
          icon={<FileText className="h-4 w-4" />}
          disabled={!requiresRun}
          ariaDescribedBy={
            disabledReason ? 'command-disabled-reason' : undefined
          }
          onClick={() => onRunCommand('explore', { type: 'diff' })}
        />
        <ActionButton
          label="plan"
          icon={<FileText className="h-4 w-4" />}
          disabled={!requiresRun}
          ariaDescribedBy={
            disabledReason ? 'command-disabled-reason' : undefined
          }
          onClick={() => onRunCommand('plan')}
        />
        <ActionButton
          label="run"
          icon={<Play className="h-4 w-4" />}
          disabled={!requiresRun}
          ariaDescribedBy={
            disabledReason ? 'command-disabled-reason' : undefined
          }
          variant="default"
          onClick={() => onRunCommand('run')}
        />
        <ActionButton
          label="verdict"
          icon={<AlertTriangle className="h-4 w-4" />}
          disabled={!requiresRun}
          ariaDescribedBy={
            disabledReason ? 'command-disabled-reason' : undefined
          }
          onClick={() => onRunCommand('verdict')}
        />

        <Separator className="my-2" />

        <div className="grid grid-cols-2 gap-2">
          <SmallActionButton
            label="merge"
            icon={<GitMerge className="h-4 w-4" />}
            disabled={!requiresRun}
            ariaDescribedBy={
              disabledReason ? 'command-disabled-reason' : undefined
            }
            onClick={() => onRunCommand('merge')}
          />
          <SmallActionButton
            label="cleanup"
            icon={<Trash2 className="h-4 w-4" />}
            disabled={!requiresRun}
            ariaDescribedBy={
              disabledReason ? 'command-disabled-reason' : undefined
            }
            onClick={() => onRunCommand('cleanup')}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ActionButton({
  label,
  icon,
  disabled,
  onClick,
  variant = 'outline',
  ariaDescribedBy,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
  variant?: 'outline' | 'default';
  ariaDescribedBy?: string;
}) {
  return (
    <Button
      className="w-full justify-start"
      variant={variant}
      disabled={disabled}
      aria-describedby={ariaDescribedBy}
      onClick={onClick}
    >
      <span suppressHydrationWarning className="mr-2">
        {icon}
      </span>
      {label}
    </Button>
  );
}

function SmallActionButton({
  label,
  icon,
  disabled,
  onClick,
  ariaDescribedBy,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
  ariaDescribedBy?: string;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      aria-describedby={ariaDescribedBy}
      onClick={onClick}
    >
      <span suppressHydrationWarning className="mr-1">
        {icon}
      </span>
      {label}
    </Button>
  );
}
