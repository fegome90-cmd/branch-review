import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface CommandOutputCardProps {
  output: string;
}

export function CommandOutputCard({ output }: CommandOutputCardProps) {
  if (!output) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Output</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea
          className="h-40 w-full rounded border bg-muted p-3"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <pre className="whitespace-pre-wrap font-mono text-sm">{output}</pre>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
