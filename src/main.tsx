import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 화면 글꼴 (3.8항, 09-6d): Apple SD Gothic Neo가 설치된 macOS는 그 글꼴, 그 외는 Pretendard(OFL, 사용 글자만 나눠 받는 웹폰트)
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './index.css'
import App from './App.tsx'
import { FONT_FAMILY } from './renderer/fonts'

// HTML 글자와 캔버스 글자가 같은 글꼴 순서를 쓰도록 한 곳(FONT_FAMILY)에서 지정
document.documentElement.style.fontFamily = FONT_FAMILY

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
