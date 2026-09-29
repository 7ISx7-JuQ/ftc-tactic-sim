import { Suspense, lazy } from 'react';
import MainScreen from './components/MainScreen';
import './App.css';

// 정식 화면 = 메인 화면 (3.8항, 09-6d). 개발 하네스(08-7)는 개발 서버에서 주소에 ?harness가 있을 때만 띄운다 (09-12에서 삭제).
// import.meta.env.DEV는 빌드 시 상수로 치환되어 정식 번들에는 하네스 코드가 포함되지 않는다.
const DevHarness = import.meta.env.DEV ? lazy(() => import('./dev/DevHarness')) : null;
const showHarness = DevHarness !== null && new URLSearchParams(window.location.search).has('harness');

function App() {
  if (DevHarness && showHarness) {
    return (
      <main className="app">
        <Suspense fallback={null}>
          <DevHarness />
        </Suspense>
      </main>
    );
  }
  return <MainScreen />;
}

export default App;
