import { Suspense, lazy } from 'react';
import FieldCanvas from './components/FieldCanvas';
import './App.css';

// 개발 서버에서만 개발 하네스(08-7)를 띄움. 정식 빌드는 Step 9 GUI 전까지 정적 필드(관중석 시점).
// import.meta.env.DEV는 빌드 시 상수로 치환되어 정식 번들에는 하네스 코드가 포함되지 않는다.
const DevHarness = import.meta.env.DEV ? lazy(() => import('./dev/DevHarness')) : null;

function App() {
  return (
    <main className="app">
      {DevHarness ? (
        <Suspense fallback={null}>
          <DevHarness />
        </Suspense>
      ) : (
        <FieldCanvas />
      )}
    </main>
  );
}

export default App;
