'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  GitBranch, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Play,
  RefreshCw,
  Trash2,
  GitMerge,
  Search,
  Code,
  Database,
  Shield,
  Zap,
  Bug,
  Loader2
} from 'lucide-react';

// Wrapper to suppress hydration warnings from browser extensions (like Dark Reader)
function Icon({ children }: { children: React.ReactNode }) {
  return <span suppressHydrationWarning>{children}</span>;
}

interface RunInfo {
  run_id: string;
  branch: string;
  base_branch: string;
  created_at: string;
  status: string;
  plan_status: string;
  plan_path?: string;
  drift_status?: string;
}

interface FinalResult {
  run_id: string;
  branch: string;
  base_branch: string;
  timestamp: string;
  verdict: 'PASS' | 'FAIL';
  statistics: {
    p0_total: number;
    p1_total: number;
    p2_total: number;
    files_changed: number;
    lines_added: number;
    lines_removed: number;
  };
  agents: Record<string, { p0: number; p1: number; p2: number; status: string }>;
  statics: Record<string, { issues: number; status: string }>;
  drift: {
    status: string;
    plan_source: string | null;
  };
}

export default function ReviewDashboard() {
  const [currentRun, setCurrentRun] = useState<RunInfo | null>(null);
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [commandOutput, setCommandOutput] = useState<string>('');
  const [runningCommand, setRunningCommand] = useState<string | null>(null);

  const fetchCurrentRun = async () => {
    try {
      const response = await fetch('/api/review/run');
      const data = await response.json();
      setCurrentRun(data.run || null);
      
      if (data.run) {
        // Try to fetch final result
        try {
          const finalResponse = await fetch(`/api/review/final?runId=${data.run.run_id}`);
          const finalData = await finalResponse.json();
          setFinalResult(finalData.result || null);
        } catch {
          setFinalResult(null);
        }
      } else {
        setFinalResult(null);
      }
    } catch (error) {
      console.error('Failed to fetch run:', error);
      setCurrentRun(null);
      setFinalResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentRun();
  }, []);

  const runCommand = async (command: string, args: Record<string, string> = {}) => {
    setRunningCommand(command);
    setCommandOutput(`Running: reviewctl ${command}...`);
    
    try {
      const response = await fetch('/api/review/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, args })
      });
      
      const data = await response.json();
      setCommandOutput(data.output || 'Command completed');
      
      // Refresh run info
      await fetchCurrentRun();
    } catch (error) {
      setCommandOutput(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRunningCommand(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: 'default' | 'destructive' | 'outline' | 'secondary'; icon: React.ReactNode }> = {
      pending: { variant: 'secondary', icon: <Icon><RefreshCw className="w-3 h-3" /></Icon> },
      exploring: { variant: 'secondary', icon: <Icon><Search className="w-3 h-3" /></Icon> },
      planning: { variant: 'secondary', icon: <Icon><FileText className="w-3 h-3" /></Icon> },
      running: { variant: 'default', icon: <Icon><Play className="w-3 h-3" /></Icon> },
      verdict: { variant: 'default', icon: <Icon><AlertTriangle className="w-3 h-3" /></Icon> },
      completed: { variant: 'default', icon: <Icon><CheckCircle2 className="w-3 h-3" /></Icon> },
      failed: { variant: 'destructive', icon: <Icon><XCircle className="w-3 h-3" /></Icon> },
    };
    
    const config = variants[status] || variants.pending;
    
    return (
      <Badge variant={config.variant} className="gap-1">
        {config.icon}
        {status}
      </Badge>
    );
  };

  const getVerdictBadge = (verdict: 'PASS' | 'FAIL') => {
    return verdict === 'PASS' ? (
      <Badge className="bg-green-500 gap-1">
        <Icon><CheckCircle2 className="w-3 h-3" /></Icon>
        PASS
      </Badge>
    ) : (
      <Badge variant="destructive" className="gap-1">
        <Icon><XCircle className="w-3 h-3" /></Icon>
        FAIL
      </Badge>
    );
  };

  const getAgentIcon = (agent: string) => {
    const icons: Record<string, React.ReactNode> = {
      'code-reviewer': <Icon><Code className="w-4 h-4" /></Icon>,
      'code-simplifier': <Icon><Zap className="w-4 h-4" /></Icon>,
      'silent-failure-hunter': <Icon><Bug className="w-4 h-4" /></Icon>,
      'sql-safety-hunter': <Icon><Database className="w-4 h-4" /></Icon>,
      'pr-test-analyzer': <Icon><Shield className="w-4 h-4" /></Icon>,
    };
    return icons[agent] || <Icon><Code className="w-4 h-4" /></Icon>;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Icon><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></Icon>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary rounded-lg">
                <Icon><GitBranch className="w-6 h-6 text-primary-foreground" /></Icon>
              </div>
              <div>
                <h1 className="text-2xl font-bold">reviewctl</h1>
                <p className="text-sm text-muted-foreground">Code Review Orchestration Dashboard</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={fetchCurrentRun}>
              <Icon><RefreshCw className="w-4 h-4 mr-2" /></Icon>
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Status & Commands */}
          <div className="space-y-6">
            {/* Current Run Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Icon><GitBranch className="w-5 h-5" /></Icon>
                  Current Run
                </CardTitle>
              </CardHeader>
              <CardContent>
                {currentRun ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Run ID</span>
                      <code className="text-sm font-mono">{currentRun.run_id}</code>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Branch</span>
                      <code className="text-sm font-mono">{currentRun.branch}</code>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      {getStatusBadge(currentRun.status)}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Plan</span>
                      <Badge variant={currentRun.plan_status === 'FOUND' ? 'default' : 'secondary'}>
                        {currentRun.plan_status}
                      </Badge>
                    </div>
                    {currentRun.drift_status && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Drift</span>
                        <Badge variant={currentRun.drift_status === 'ALIGNED' ? 'default' : 
                                       currentRun.drift_status === 'DRIFT_RISK' ? 'secondary' : 'destructive'}>
                          {currentRun.drift_status}
                        </Badge>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    <Icon><GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" /></Icon>
                    <p>No active review run</p>
                    <p className="text-sm">Initialize a new run to get started</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Commands */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Commands</CardTitle>
                <CardDescription>Execute reviewctl commands</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  className="w-full justify-start" 
                  variant="outline"
                  onClick={() => runCommand('init', { create: 'true' })}
                  disabled={runningCommand !== null}
                >
                  <Icon><Play className="w-4 h-4 mr-2" /></Icon>
                  init --create
                </Button>
                
                <Button 
                  className="w-full justify-start" 
                  variant="outline"
                  onClick={() => runCommand('explore', { type: 'context' })}
                  disabled={runningCommand !== null || !currentRun}
                >
                  <Icon><Search className="w-4 h-4 mr-2" /></Icon>
                  explore context
                </Button>
                
                <Button 
                  className="w-full justify-start" 
                  variant="outline"
                  onClick={() => runCommand('explore', { type: 'diff' })}
                  disabled={runningCommand !== null || !currentRun}
                >
                  <Icon><FileText className="w-4 h-4 mr-2" /></Icon>
                  explore diff
                </Button>
                
                <Button 
                  className="w-full justify-start" 
                  variant="outline"
                  onClick={() => runCommand('plan', {})}
                  disabled={runningCommand !== null || !currentRun}
                >
                  <Icon><FileText className="w-4 h-4 mr-2" /></Icon>
                  plan
                </Button>
                
                <Button 
                  className="w-full justify-start" 
                  variant="default"
                  onClick={() => runCommand('run', {})}
                  disabled={runningCommand !== null || !currentRun}
                >
                  <Icon><Play className="w-4 h-4 mr-2" /></Icon>
                  run
                </Button>
                
                <Button 
                  className="w-full justify-start" 
                  variant="outline"
                  onClick={() => runCommand('verdict', {})}
                  disabled={runningCommand !== null || !currentRun}
                >
                  <Icon><AlertTriangle className="w-4 h-4 mr-2" /></Icon>
                  verdict
                </Button>
                
                <Separator className="my-2" />
                
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    size="sm"
                    variant="outline"
                    onClick={() => runCommand('merge', {})}
                    disabled={runningCommand !== null || !currentRun}
                  >
                    <Icon><GitMerge className="w-4 h-4 mr-1" /></Icon>
                    merge
                  </Button>
                  <Button 
                    size="sm"
                    variant="outline"
                    onClick={() => runCommand('cleanup', {})}
                    disabled={runningCommand !== null || !currentRun}
                  >
                    <Icon><Trash2 className="w-4 h-4 mr-1" /></Icon>
                    cleanup
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Command Output */}
            {commandOutput && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Output</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-40 w-full rounded border bg-muted p-3">
                    <pre className="text-sm font-mono whitespace-pre-wrap">{commandOutput}</pre>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Middle Column - Results */}
          <div className="lg:col-span-2 space-y-6">
            {finalResult ? (
              <Tabs defaultValue="summary">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="agents">Agents</TabsTrigger>
                  <TabsTrigger value="statics">Statics</TabsTrigger>
                  <TabsTrigger value="drift">Drift</TabsTrigger>
                </TabsList>
                
                <TabsContent value="summary" className="space-y-4">
                  {/* Verdict Card */}
                  <Card className={finalResult.verdict === 'PASS' ? 'border-green-500' : 'border-red-500'}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle>Verdict</CardTitle>
                        {getVerdictBadge(finalResult.verdict)}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="text-center p-4 rounded-lg bg-red-50 dark:bg-red-950">
                          <div className="text-3xl font-bold text-red-600 dark:text-red-400">
                            {finalResult.statistics.p0_total}
                          </div>
                          <div className="text-sm text-muted-foreground">P0 (Blocking)</div>
                        </div>
                        <div className="text-center p-4 rounded-lg bg-yellow-50 dark:bg-yellow-950">
                          <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">
                            {finalResult.statistics.p1_total}
                          </div>
                          <div className="text-sm text-muted-foreground">P1 (Important)</div>
                        </div>
                        <div className="text-center p-4 rounded-lg bg-blue-50 dark:bg-blue-950">
                          <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                            {finalResult.statistics.p2_total}
                          </div>
                          <div className="text-sm text-muted-foreground">P2 (Minor)</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Statistics */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Change Statistics</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <div className="text-2xl font-bold">{finalResult.statistics.files_changed}</div>
                          <div className="text-sm text-muted-foreground">Files Changed</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-green-600">+{finalResult.statistics.lines_added}</div>
                          <div className="text-sm text-muted-foreground">Lines Added</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-red-600">-{finalResult.statistics.lines_removed}</div>
                          <div className="text-sm text-muted-foreground">Lines Removed</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold">
                            {finalResult.statistics.lines_added - finalResult.statistics.lines_removed > 0 ? '+' : ''}
                            {finalResult.statistics.lines_added - finalResult.statistics.lines_removed}
                          </div>
                          <div className="text-sm text-muted-foreground">Net Change</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
                
                <TabsContent value="agents">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Agent Results</CardTitle>
                      <CardDescription>Findings by review agent</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {Object.entries(finalResult.agents).map(([agent, stats]) => (
                          <div key={agent} className="flex items-center justify-between p-4 rounded-lg border">
                            <div className="flex items-center gap-3">
                              {getAgentIcon(agent)}
                              <div>
                                <div className="font-medium">{agent}</div>
                                <div className="text-sm text-muted-foreground">
                                  Status: {stats.status}
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              {stats.p0 > 0 && <Badge variant="destructive">{stats.p0} P0</Badge>}
                              {stats.p1 > 0 && <Badge variant="secondary">{stats.p1} P1</Badge>}
                              {stats.p2 > 0 && <Badge variant="outline">{stats.p2} P2</Badge>}
                              {stats.p0 === 0 && stats.p1 === 0 && stats.p2 === 0 && (
                                <Badge variant="default">Clean</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
                
                <TabsContent value="statics">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Static Analysis</CardTitle>
                      <CardDescription>Results from static analysis tools</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {Object.entries(finalResult.statics).map(([tool, stats]) => (
                          <div key={tool} className="flex items-center justify-between p-4 rounded-lg border">
                            <div className="flex items-center gap-3">
                              <Icon><Code className="w-5 h-5 text-muted-foreground" /></Icon>
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
                        {Object.keys(finalResult.statics).length === 0 && (
                          <div className="text-center py-8 text-muted-foreground">
                            No static analysis results
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
                
                <TabsContent value="drift">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Drift Analysis</CardTitle>
                      <CardDescription>Plan vs Implementation comparison</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 rounded-lg border">
                          <span className="font-medium">Status</span>
                          <Badge variant={
                            finalResult.drift.status === 'ALIGNED' ? 'default' :
                            finalResult.drift.status === 'DRIFT_RISK' ? 'secondary' : 'destructive'
                          }>
                            {finalResult.drift.status}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between p-4 rounded-lg border">
                          <span className="font-medium">Plan Source</span>
                          <code className="text-sm font-mono">
                            {finalResult.drift.plan_source || 'None'}
                          </code>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            ) : (
              <Card className="h-96 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <Icon><FileText className="w-12 h-12 mx-auto mb-4 opacity-50" /></Icon>
                  <p className="text-lg font-medium">No Review Results</p>
                  <p className="text-sm">Run a complete review to see results here</p>
                </div>
              </Card>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-auto">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>reviewctl v1.0 - Code Review Orchestration</span>
            <span>SSOT Templates • Anti-Loop • Plan Resolver</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
