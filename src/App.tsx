import { EngineStatus } from './ui/EngineStatus';
import { useEngine } from './ui/useEngine';

export function App() {
  const { state: engineState, retry } = useEngine();

  return (
    <main className="app">
      <header className="app-header">
        <h1>docx-diff</h1>
        <EngineStatus state={engineState} onRetry={retry} />
      </header>
    </main>
  );
}
