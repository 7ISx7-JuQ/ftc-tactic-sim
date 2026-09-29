// 화면 문구 사전 (명세서 3.8 기본 원칙, 09-6a): 기본 영어, 한국어 토글
// - 모든 화면 문구(캔버스 글자 포함)는 t(key)를 거친다. 키는 영어 사전 기준이며 한국어 사전은 타입으로 모든 키를 강제한다.
// - 런타임에 사전에 없는 키 / 언어가 들어오면 영어 → 키 문자열 순으로 대체한다.
// - 게임 용어는 언어와 무관하게 원어 대문자 (GAME_TERMS). 한국어 문구는 짧은 명사형.
// - 자리표시자: {name} → params.name (없는 자리표시자는 그대로 둠)
// 문구는 화면을 만드는 하위 Step마다 필요한 만큼 추가한다.

export type Language = 'en' | 'ko';
export const LANGUAGES: readonly Language[] = ['en', 'ko'];
export const DEFAULT_LANGUAGE: Language = 'en';

/** 원어 대문자로만 쓰는 게임 용어 (명세서 3.8) */
export const GAME_TERMS = [
  'POLLEN', 'NECTAR', 'HIVE', 'CELL', 'FLOWER', 'GARDEN', 'LOADING ZONE', 'TIP', 'PARK',
  'ENDGAME', 'TELEOP', 'SWARM', 'POLLINATOR', 'RP', 'RED', 'BLUE', 'ALLIANCE',
] as const;

const en = {
  'app.name': 'FTC TacticSim',
  'language.en': 'English',
  'language.ko': '한국어',

  // 스크러버 줄 (3.8 화면 구성)
  'control.start': 'START',
  'control.pause': 'PAUSE',
  'control.resume': 'RESUME',
  'control.branch': 'BRANCH',
  'control.play': 'Play',
  'control.stopPlayback': 'Stop',
  'control.stepBackTick': 'Back 1 tick',
  'control.stepForwardTick': 'Forward 1 tick',
  'control.stepBackSecond': 'Back 1 s',
  'control.stepForwardSecond': 'Forward 1 s',
  'control.speed': 'Speed',
  'control.view': 'VIEW',
  'control.newMatch': 'NEW',
  'control.result': 'RESULT',
  'view.driver': 'Driver view',
  'view.audience': 'Audience view',

  // 확인창
  'confirm.branch': 'Recorded match after {time} ({seconds} s) will be deleted. Drive again from here?',
  'confirm.newMatch': 'Discard this match and start a new one with the same settings?',
  'confirm.ok': 'OK',
  'confirm.cancel': 'Cancel',

  // 좌측 득점 패널
  'panel.timeRemaining': 'Time remaining',
  'panel.score': 'Score',
  'panel.tip': 'TIP',
  'panel.hitProbability': 'Hit probability',
  'panel.noLoadout': 'Empty',
  'panel.noResolver': 'No shot model',

  // 경고 토스트 / 자동 일시정지 배너
  'toast.lowerLift': 'LOWER LIFT (A) TO MOVE',
  'pause.USER': 'Paused',
  'pause.HIDDEN': 'Paused: tab hidden',
  'pause.BLUR': 'Paused: window lost focus',
  'pause.GAMEPAD_DISCONNECTED': 'Paused: gamepad disconnected',

  // config 창
  'config.open': 'Open settings',
  'config.close': 'Close settings',
  'config.tab.r1': 'R1',
  'config.tab.r2': 'R2',
  'config.tab.scenario': 'SCENARIO',
  'config.tab.settings': 'SETTINGS',
  'config.apply': 'APPLY',
  'config.resetTab': 'RESET TAB',
  'config.resetAll': 'RESET ALL',
  'config.unappliedChanges': 'Unapplied changes',
  'config.lockedDuringMatch': 'Locked while a match exists',
  'config.startBlocked': 'Cannot start: {reason}',

  // LUT 생성 상태 (2.6.2 로봇별 상태 머신)
  'lut.IDLE': 'Not configured',
  'lut.QUEUED': 'Queued',
  'lut.SEARCHING': 'Searching launch speed',
  'lut.GENERATING': 'Generating hit map {percent}%',
  'lut.READY': 'Ready',
  'lut.ERROR': 'Error: {message}',
  'lut.CANCELLED': 'Cancelled',
  'lut.zeroHitRate': 'No hits from this sweet spot — check the settings',
  'lut.remaining': 'About {seconds} s left',

  // 시나리오 검증 (validateScenario, 2.4)
  'issue.FLOWER_COUNT': 'POLLEN per FLOWER must be an integer from 0 to 4',
  'issue.GARDEN_COUNT': 'POLLEN per GARDEN must be an integer from 0 to 8',
  'issue.HIVE_COUNT': 'HIVE POLLEN must be 0 or more and NECTAR 0 to 3',
  'issue.HIVE_OVER_THRESHOLD': 'The upward CELL already reaches the TIP threshold',
  'issue.LOADOUT_OVER_CAPACITY': 'Loadout exceeds the robot capacity',
  'issue.LOADOUT_NECTAR_NOT_ALLOWED': 'This robot cannot hold NECTAR',
  'issue.NECTAR_IN_PLAY_EXCEEDED': 'HIVE + robot NECTAR exceeds the 3 NECTAR in play',
  'issue.POLLEN_TOTAL_EXCEEDED': 'Specified POLLEN exceeds the 32 in total',
  'issue.AUTO_TIP_COUNT': 'Auto TIP count must be an integer from 0 to 5',
  // 시작 자세 배치 검증 (validateRobotPlacement, 3.8)
  'issue.PLACEMENT_OUT_OF_FIELD': '{robot} body is outside the field',
  'issue.PLACEMENT_IN_HIVE': '{robot} body overlaps the HIVE',
  'issue.PLACEMENT_IN_FLOWER': '{robot} body overlaps a FLOWER',
  'issue.PLACEMENT_ROBOT_OVERLAP': 'R1 and R2 bodies overlap',
  'issue.PLACEMENT_PIECE_OVERLAP': '{robot} body overlaps GARDEN POLLEN',
  // 탄도 설정 검증 (validateBallisticsConfig, 2.6.2)
  'issue.PARAM_INVALID': 'Invalid shooter parameters',
  'issue.SWEET_SPOT_OUT_OF_FIELD': 'Robot body at the sweet spot is outside the field',
  'issue.SWEET_SPOT_IN_HIVE': 'Robot body at the sweet spot overlaps the HIVE',
  'issue.SWEET_SPOT_NO_SOLUTION': 'No launch speed reaches the CELL from the sweet spot',
} as const;

export type MessageKey = keyof typeof en;

const ko: Record<MessageKey, string> = {
  'app.name': 'FTC TacticSim',
  'language.en': 'English',
  'language.ko': '한국어',

  'control.start': '시작',
  'control.pause': '일시정지',
  'control.resume': '재개',
  'control.branch': '분기',
  'control.play': '재생',
  'control.stopPlayback': '정지',
  'control.stepBackTick': '1틱 뒤로',
  'control.stepForwardTick': '1틱 앞으로',
  'control.stepBackSecond': '1초 뒤로',
  'control.stepForwardSecond': '1초 앞으로',
  'control.speed': '배속',
  'control.view': '시점',
  'control.newMatch': '새 경기',
  'control.result': '결과',
  'view.driver': '드라이버 시점',
  'view.audience': '관중석 시점',

  'confirm.branch': '{time} 이후 기록 {seconds}초가 삭제됩니다. 여기서부터 다시 조종할까요?',
  'confirm.newMatch': '이 경기를 버리고 같은 설정으로 새 경기를 시작할까요?',
  'confirm.ok': '확인',
  'confirm.cancel': '취소',

  'panel.timeRemaining': '남은 시간',
  'panel.score': '점수',
  'panel.tip': 'TIP',
  'panel.hitProbability': '명중 확률',
  'panel.noLoadout': '적재 없음',
  'panel.noResolver': '판정 함수 없음',

  'toast.lowerLift': 'A로 리프트를 내려야 이동 가능',
  'pause.USER': '일시정지',
  'pause.HIDDEN': '일시정지: 탭 숨김',
  'pause.BLUR': '일시정지: 창 포커스 잃음',
  'pause.GAMEPAD_DISCONNECTED': '일시정지: 게임패드 연결 해제',

  'config.open': '설정 열기',
  'config.close': '설정 닫기',
  'config.tab.r1': 'R1',
  'config.tab.r2': 'R2',
  'config.tab.scenario': '시나리오',
  'config.tab.settings': '환경 및 조작',
  'config.apply': '적용',
  'config.resetTab': '탭 초기화',
  'config.resetAll': '전체 초기화',
  'config.unappliedChanges': '적용 안 된 수정',
  'config.lockedDuringMatch': '경기 중 잠금',
  'config.startBlocked': '시작 불가: {reason}',

  'lut.IDLE': '설정 없음',
  'lut.QUEUED': '대기 중',
  'lut.SEARCHING': '발사 속도 탐색 중',
  'lut.GENERATING': '확률표 생성 중 {percent}%',
  'lut.READY': '준비 완료',
  'lut.ERROR': '오류: {message}',
  'lut.CANCELLED': '취소됨',
  'lut.zeroHitRate': '이 스윗스팟에서는 명중 불가 — 설정 확인',
  'lut.remaining': '약 {seconds}초 남음',

  'issue.FLOWER_COUNT': 'FLOWER별 POLLEN 수는 0 ~ 4 정수',
  'issue.GARDEN_COUNT': 'GARDEN별 POLLEN 수는 0 ~ 8 정수',
  'issue.HIVE_COUNT': 'HIVE POLLEN은 0 이상, NECTAR는 0 ~ 3',
  'issue.HIVE_OVER_THRESHOLD': '상향 CELL이 이미 TIP 임계에 도달',
  'issue.LOADOUT_OVER_CAPACITY': '적재물이 로봇 적재 한도 초과',
  'issue.LOADOUT_NECTAR_NOT_ALLOWED': 'NECTAR를 적재할 수 없는 로봇',
  'issue.NECTAR_IN_PLAY_EXCEEDED': 'HIVE + 로봇 NECTAR가 필드의 NECTAR 3개 초과',
  'issue.POLLEN_TOTAL_EXCEEDED': '지정한 POLLEN이 총 32개 초과',
  'issue.AUTO_TIP_COUNT': '오토 TIP 횟수는 0 ~ 5 정수',
  'issue.PLACEMENT_OUT_OF_FIELD': '{robot} 몸체가 필드 밖으로 나감',
  'issue.PLACEMENT_IN_HIVE': '{robot} 몸체가 HIVE와 겹침',
  'issue.PLACEMENT_IN_FLOWER': '{robot} 몸체가 FLOWER와 겹침',
  'issue.PLACEMENT_ROBOT_OVERLAP': 'R1과 R2 몸체가 겹침',
  'issue.PLACEMENT_PIECE_OVERLAP': '{robot} 몸체가 GARDEN POLLEN과 겹침',
  'issue.PARAM_INVALID': '슈터 설정값 오류',
  'issue.SWEET_SPOT_OUT_OF_FIELD': '스윗스팟의 로봇 몸체가 필드 밖으로 나감',
  'issue.SWEET_SPOT_IN_HIVE': '스윗스팟의 로봇 몸체가 HIVE와 겹침',
  'issue.SWEET_SPOT_NO_SOLUTION': '스윗스팟에서 CELL에 닿는 발사 속도 없음',
};

export const MESSAGES: Readonly<Record<Language, Readonly<Record<MessageKey, string>>>> = { en, ko };

export type MessageParams = Readonly<Record<string, string | number>>;

/** 문구 조회 + 자리표시자 치환. 사전에 없는 언어 / 키는 영어, 그래도 없으면 키 문자열 */
export function t(lang: Language, key: MessageKey, params?: MessageParams): string {
  const dict = (MESSAGES as Partial<Record<string, Readonly<Record<string, string>>>>)[lang];
  const template = dict?.[key] ?? (en as Readonly<Record<string, string>>)[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** 언어 문자열 검증 (저장된 값 복원 등): 알 수 없으면 기본 언어 */
export function toLanguage(value: unknown): Language {
  return LANGUAGES.includes(value as Language) ? (value as Language) : DEFAULT_LANGUAGE;
}
