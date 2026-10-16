import { Terminal } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Shown when the renderer is opened outside Electron, which happens during
 * `next dev`. Better than a blank screen or a bridge-not-found crash.
 */
export function NotInApp() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4" />
            Open Vokluna as an app
          </CardTitle>
          <CardDescription>
            This page is the renderer, but the app runs in Electron — the microphone capture,
            transcription and global hotkey all live in the main process.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-3 text-sm">
          <p>From the project directory, run:</p>
          <pre className="bg-muted selectable rounded-md p-3 font-mono text-xs">npm run dev</pre>
          <p>
            That starts the Next dev server and launches the Electron shell against it. The window
            that opens is the real app.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
