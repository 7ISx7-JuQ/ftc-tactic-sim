// LUT 생성 Web Worker 진입점 (명세서 2.6.2 LUT 생성 실행 1, 09-3)
// 메시지를 받아 lutProtocol.ts의 처리기에 넘기기만 하는 얇은 층. 생성은 createLUTWorker.ts.

import { handleLUTJob } from './lutProtocol';
import type { LUTJobMessage, LUTWorkerMessage } from './lutProtocol';

// tsconfig lib에 WebWorker가 없으므로 Worker 전역에서 쓰는 부분만 좁혀서 사용
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<LUTJobMessage>) => void) | null;
  postMessage(message: LUTWorkerMessage, transfer?: Transferable[]): void;
};

scope.onmessage = event => {
  handleLUTJob(event.data, (message, transfer) => scope.postMessage(message, transfer ?? []));
};
