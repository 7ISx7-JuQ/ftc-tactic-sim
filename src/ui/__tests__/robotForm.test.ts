// 로봇 제원 탭 폼 규칙 (명세서 3.8 로봇 제원 탭, 09-9a)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_VALUES } from '../../app/defaultSetup';
import { FIXED_AIM_TOLERANCE } from '../../core/ballistics';
import { getBumperZoneOBB } from '../../core/collision';
import type { BumperSide } from '../../core/types';
import {
  MAX_INTAKE_ZONES,
  NUMBER_FIELDS,
  displayRange,
  newIntakeZone,
  previewAimSector,
  previewZoneRect,
  writeZone,
  zoneFieldSpec,
  TURRET_PRESETS,
  checkText,
  copyRobotProfile,
  formatField,
  parseNumberField,
  readNumber,
  robotProfileIssues,
  writeNumber,
  DEFAULT_SWEET_SPOT,
  DEFAULT_PROFILE_BALLISTICS,
  SWEET_SPOT_SPEC,
  profileBallisticsConfig,
  profileLUTShooters,
  readSweetSpot,
  writeSweetSpot,
  SHOOTER_FIELD_KEYS,
  SHOOTER_SETUPS,
  isZoneFieldKey,
  previewMuzzle,
  previewShooters,
  shooterFieldKey,
  shooterSetupAllowed,
  slotAim,
  slotBallistics,
  sweetSpotFieldKey,
  usedShooterSlots,
  writeSlotAim,
  zoneFieldKey,
} from '../robotForm';
import type { RobotProfile } from '../robotForm';

const r1 = DEFAULT_DRAFT_VALUES.robot1;
const parse = (key: keyof typeof NUMBER_FIELDS, text: string, unit: 'in' | 'cm' = 'in') => parseNumberField(NUMBER_FIELDS[key], text, unit);

describe('로봇 제원 폼 (09-9a)', () => {
  it('A. 기본 프로필은 모든 범위 안 (팀 번호 / 팀명 비어 있음)', () => {
    expect(robotProfileIssues(r1)).toEqual([]);
    expect(robotProfileIssues(DEFAULT_DRAFT_VALUES.robot2)).toEqual([]);
    expect(r1.teamNumber === '' && r1.teamName === '').toBe(true);
  });

  it('B. 입력 → 엔진 값: 단위 변환 1회, 범위 / 정수 / 빈 칸 오류, 경계는 경계값으로', () => {
    expect(parse('width', '12')).toEqual({ ok: true, value: 12 });
    expect(parse('width', '30.48', 'cm')).toEqual({ ok: true, value: 12 });
    expect(parse('width', '45.72', 'cm')).toEqual({ ok: true, value: 18 }); // 표시값을 그대로 다시 입력해도 원래 inch
    expect(parse('width', '5')).toEqual({ ok: false, error: { code: 'RANGE', min: 6, max: 18 } });
    expect(parse('width', '18.01')).toMatchObject({ ok: false, error: { code: 'RANGE' } });
    expect(parse('width', 'abc')).toEqual({ ok: false, error: { code: 'REQUIRED' } });
    expect(parse('width', '')).toEqual({ ok: false, error: { code: 'REQUIRED' } });
    expect(parse('maxControlledPieces', '2.5')).toEqual({ ok: false, error: { code: 'INTEGER' } });
    expect(parse('maxControlledPieces', '4')).toEqual({ ok: true, value: 4 });
    expect(parse('maxControlledPieces', '0')).toMatchObject({ ok: false, error: { code: 'RANGE' } });
    expect(parse('intakeDelay', '100.5')).toEqual({ ok: false, error: { code: 'INTEGER' } });
    expect(parse('intakeDelay', '5000')).toEqual({ ok: true, value: 5000 });
    expect(Object.keys(NUMBER_FIELDS)).not.toContain('aimTolerance'); // 11-3: 허용 조준 오차 칸 없음
    expect(parse('turretLeft', '-180')).toEqual({ ok: true, value: -Math.PI });
    expect(parse('turretRight', '180')).toEqual({ ok: true, value: Math.PI });
    expect(parse('maxTurnRate', '4')).toEqual({ ok: true, value: 4 }); // rad/s 그대로
    expect(parse('maxSpeed', '152.4', 'cm')).toEqual({ ok: true, value: 60 });
  });

  it('C. 엔진 값 → 표시 (in / cm, °, 개수)', () => {
    expect(formatField(NUMBER_FIELDS.width, 18, 'in')).toBe('18.00');
    expect(formatField(NUMBER_FIELDS.width, 18, 'cm')).toBe('45.72');
    expect(formatField(NUMBER_FIELDS.shooterPitch, Math.PI / 3, 'in')).toBe('60.0');
    expect(formatField(NUMBER_FIELDS.maxControlledPieces, 4, 'cm')).toBe('4');
    expect(formatField(NUMBER_FIELDS.turretLeft, -Math.PI, 'in')).toBe('-180.0');
    expect(formatField(NUMBER_FIELDS.maxAngularAccel, 10, 'cm')).toBe('10.00');
  });

  it('D. 팀 번호 (숫자 0 ~ 5자리) / 팀명 (24자까지)', () => {
    for (const ok of ['', '1', '19049', ' 123 ']) expect(checkText('teamNumber', ok)).toBeNull();
    for (const bad of ['123456', '12a', '-1', '1.5']) expect(checkText('teamNumber', bad)).toEqual({ code: 'TEAM_NUMBER' });
    expect(checkText('teamName', 'x'.repeat(24))).toBeNull();
    expect(checkText('teamName', 'x'.repeat(25))).toEqual({ code: 'TEAM_NAME' });
  });

  it('E. 프로필 검증: 범위 밖 칸, 터렛 폭 0 (고정형은 무관), 읽기 / 쓰기', () => {
    expect(robotProfileIssues(writeNumber(r1, 'width', 20)).map(i => i.code)).toEqual(['FIELD_width']);
    const turret = { ...r1, config: { ...r1.config, turretType: 'TURRET' as const } };
    expect(robotProfileIssues(turret).map(i => i.code)).toEqual(['TURRET_WIDTH']); // 기본 [0, 0]
    const wrapped = writeNumber(writeNumber(turret, 'turretLeft', 2.5), 'turretRight', -2.5); // 후방 (±π 가로지름)
    expect(robotProfileIssues(wrapped)).toEqual([]);
    expect(readNumber(wrapped, 'turretLeft') === 2.5 && readNumber(wrapped, 'turretRight') === -2.5).toBe(true);
    expect(r1.config.turretRange).toEqual([0, 0]); // 쓰기는 복사본
    expect(TURRET_PRESETS.full).toEqual([-Math.PI, Math.PI]);
    expect(robotProfileIssues({ ...r1, teamNumber: 'abc' }).map(i => i.code)).toEqual(['FIELD_teamNumber']);
  });

  it('F. COPY TO: 팀 번호 / 팀명 / 슬롯 id / 이름은 대상 유지, 나머지 복사 (깊은 복사)', () => {
    const source = { teamNumber: '19049', teamName: 'Bees', config: { ...r1.config, width: 14, maxSpeed: 80 }, ballistics: { ...r1.ballistics, dz: 30 } };
    const target = { ...DEFAULT_DRAFT_VALUES.robot2, teamNumber: '24909', teamName: 'Hornets' };
    const copied = copyRobotProfile(source, target, 'robot2');
    expect(copied.teamNumber === '24909' && copied.teamName === 'Hornets').toBe(true);
    expect(copied.config).toEqual({ ...source.config, id: 'robot2', name: 'R2' });
    expect(copied.ballistics).toEqual(source.ballistics); // (09-9b) 탄도도 복사
    copied.config.intakeZones[0].width = 1;
    expect(source.config.intakeZones[0].width).toBe(18);
  });

  it('G. (09-9b) 슈터 탄도 칸: 발사구 지상고 ↔ dz, 발사각 / 오프셋 / 편차 범위, 오류 범위 표시는 화면 값 순서', () => {
    expect(r1.ballistics).toMatchObject({ dz: 53.5 - 14, shooterPitch: Math.PI / 3, shooterOffset: 0, v0NoisePercent: 0.02 });
    expect(parse('launchHeight', '14')).toEqual({ ok: true, value: 39.5 });
    expect(parse('launchHeight', '50.8', 'cm')).toEqual({ ok: true, value: 53.5 - 20 });
    expect(parse('launchHeight', '0.5')).toMatchObject({ ok: false, error: { code: 'RANGE' } });
    expect(parse('launchHeight', '50.5')).toMatchObject({ ok: false, error: { code: 'RANGE' } });
    expect(displayRange(NUMBER_FIELDS.launchHeight, 'in')).toEqual(['1.00', '50.00']); // dz 범위를 뒤집어 h로 표시
    expect(formatField(NUMBER_FIELDS.launchHeight, 39.5, 'in')).toBe('14.00');
    expect(parse('shooterPitch', '60')).toEqual({ ok: true, value: Math.PI / 3 });
    expect(parse('shooterPitch', '4')).toMatchObject({ ok: false });
    expect(parse('shooterPitch', '86')).toMatchObject({ ok: false });
    expect(parse('shooterOffset', '-18')).toEqual({ ok: true, value: -18 });
    expect(parse('shooterOffset', '19')).toMatchObject({ ok: false });
    expect(parse('v0NoisePercent', '2')).toEqual({ ok: true, value: 0.02 });
    expect(parse('v0NoisePercent', '25')).toMatchObject({ ok: false });
    expect(parse('headingNoiseRad', '0')).toEqual({ ok: true, value: 0 });
    expect(parse('pitchNoiseRad', '10.5')).toMatchObject({ ok: false });
    const moved = writeNumber(r1, 'launchHeight', 30);
    expect(readNumber(moved, 'launchHeight') === 30 && moved.config === r1.config && r1.ballistics.dz === 39.5).toBe(true);
    expect(robotProfileIssues({ ...r1, ballistics: { ...r1.ballistics, shooterPitch: 1.6 } }).map(i => i.code)).toEqual(['FIELD_shooterPitch']);
  });

  it('H. (09-9b) 흡입 구역 칸: offset 범위 = ± 변 길이 / 2 (면 / 로봇 크기), 폭 / 깊이, 개수 0 ~ 8', () => {
    const body = { width: 18, length: 14 };
    expect(zoneFieldSpec('offset', 'FRONT', body)).toMatchObject({ min: -9, max: 9 });
    expect(zoneFieldSpec('offset', 'LEFT', body)).toMatchObject({ min: -7, max: 7 });
    expect(zoneFieldSpec('width', 'BACK', body)).toMatchObject({ min: 3.6, max: 36 }); // NECTAR 직경 (09-9c)
    expect(robotProfileIssues(writeZone(r1, 0, { width: 3.6 }))).toEqual([]);
    expect(robotProfileIssues(writeZone(r1, 0, { width: 3.5 })).map(i => i.code)).toEqual(['FIELD_zone.0.width']); // POLLEN(2.8)은 들어가도 NECTAR는 불가
    expect(zoneFieldSpec('depth', 'RIGHT', body)).toMatchObject({ min: 0.25, max: 12 });
    expect(newIntakeZone(body)).toEqual({ side: 'FRONT', offset: 0, width: 18, depth: 1 });
    const shifted = writeZone(r1, 0, { offset: 10 }); // 가로 18 in → ±9 밖
    expect(robotProfileIssues(shifted).map(i => i.code)).toEqual(['FIELD_zone.0.offset']);
    expect(r1.config.intakeZones[0].offset).toBe(0);
    const side = writeZone(r1, 0, { side: 'LEFT', offset: 8.5 }); // 세로 18 in → ±9 안
    expect(robotProfileIssues(side)).toEqual([]);
    const zonesOf = (n: number) => ({ ...r1, config: { ...r1.config, intakeZones: Array.from({ length: n }, () => newIntakeZone(r1.config)) } });
    expect(robotProfileIssues(zonesOf(MAX_INTAKE_ZONES))).toEqual([]);
    expect(robotProfileIssues(zonesOf(MAX_INTAKE_ZONES + 1)).map(i => i.code)).toEqual(['ZONE_COUNT']);
    expect(robotProfileIssues({ ...r1, config: { ...r1.config, intakeZones: [] } })).toEqual([]); // 0개 허용 (흡입 불가 경고)
    expect(robotProfileIssues(writeZone(r1, 0, { side: 'TOP' as BumperSide })).map(i => i.code)).toEqual(['FIELD_zone.0.offset']);
    expect(robotProfileIssues(writeZone(r1, 0, { depth: 0.1 })).map(i => i.code)).toEqual(['FIELD_zone.0.depth']);
  });

  it('I. (09-9b) 미리보기 기하 = 엔진 getBumperZoneOBB (헤딩 0: 앞 = +x, 오른쪽 = +y), 조준 부채꼴', () => {
    const config = { width: 14, length: 18 };
    const body = { center: { x: 0, y: 0 }, axes: [{ x: 1, y: 0 }, { x: 0, y: 1 }] as [{ x: number; y: number }, { x: number; y: number }], halfExtents: [9, 7] as [number, number] };
    for (const side of ['FRONT', 'BACK', 'LEFT', 'RIGHT'] as const) {
      for (const offset of [0, 3, -5, 20, -20]) { // ±20: 변 밖 → 엔진처럼 양끝으로 제한
        const zone = { side, offset, width: 4, depth: 2 };
        const rect = previewZoneRect(zone, config)!;
        const obb = getBumperZoneOBB(body, zone)!;
        expect([rect.fwd, rect.right, rect.fwdSize / 2, rect.rightSize / 2]).toEqual([obb.center.x, obb.center.y, obb.halfExtents[0], obb.halfExtents[1]]);
      }
    }
    expect(previewZoneRect({ side: 'FRONT', offset: 0, width: 0, depth: 1 }, config)).toBeNull();
    expect(previewAimSector({ turretType: 'FIXED', turretRange: [0, 0] })).toEqual({ start: -FIXED_AIM_TOLERANCE, end: FIXED_AIM_TOLERANCE }); // 11-3 임시 상수
    expect(previewAimSector({ turretType: 'TURRET', turretRange: [-1, 1] })).toEqual({ start: -1, end: 1 });
    expect(previewAimSector({ turretType: 'TURRET', turretRange: [2.5, -2.5] })).toEqual({ start: 2.5, end: -2.5 + 2 * Math.PI }); // 후방
  });

  it('J. (09-10a) 스윗스팟: 기본값 C, 진영 기준 읽기 / 쓰기(BLUE = 점대칭, 격자 중심으로 맞춤), 범위 / 탄도 검증, 복사', () => {
    expect(r1.ballistics.sweetSpot).toEqual({ x: 59.5, y: 131.5 });
    expect(DEFAULT_SWEET_SPOT).toEqual({ x: 59.5, y: 131.5 });
    expect(readSweetSpot(r1, 'RED')).toEqual({ x: 59.5, y: 131.5 });
    expect(readSweetSpot(r1, 'BLUE')).toEqual({ x: 84.5, y: 12.5 });
    // RED: 60 → 칸 [60, 61)의 중심 60.5, 다른 축 유지
    expect(writeSweetSpot(r1, 'RED', 'x', 60).ballistics.sweetSpot).toEqual({ x: 60.5, y: 131.5 });
    expect(writeSweetSpot(r1, 'RED', 'y', 127.9).ballistics.sweetSpot).toEqual({ x: 59.5, y: 127.5 });
    // BLUE: 화면 x 90.2 → 칸 중심 90.5 → 보관 144 − 90.5 = 53.5, y는 그대로 (보관 131.5)
    const blue = writeSweetSpot(r1, 'BLUE', 'x', 90.2);
    expect(blue.ballistics.sweetSpot).toEqual({ x: 53.5, y: 131.5 });
    expect(readSweetSpot(blue, 'BLUE')).toEqual({ x: 90.5, y: 12.5 });
    expect(r1.ballistics.sweetSpot).toEqual({ x: 59.5, y: 131.5 }); // 원본 불변
    expect(SWEET_SPOT_SPEC).toMatchObject({ kind: 'coordinate', min: 0, max: 144 });
    // 주 슈터의 탄도 설정 = 주 슈터 탄도 항목 (좌우 오프셋 포함, NECTAR 슈터 카드 제외)
    const { nectarShooter, ...primary } = r1.ballistics;
    expect(nectarShooter).toEqual(DEFAULT_PROFILE_BALLISTICS.nectarShooter);
    expect(primary.shooterLateralOffset).toBe(0);
    expect(profileBallisticsConfig(r1)).toEqual({ ...primary, sweetSpot: { x: 59.5, y: 131.5 } });
    // 검증: 칸 범위 → 탄도 검증 (HIVE / 해 없음 / 로봇 몸체 필드 밖)
    const at = (x: number, y: number) => ({ ...r1, ballistics: { ...r1.ballistics, sweetSpot: { x, y } } });
    expect(robotProfileIssues(at(-1, 131.5)).map(i => i.code)).toEqual(['FIELD_sweetSpot.x']);
    expect(robotProfileIssues(at(59.5, 145)).map(i => i.code)).toEqual(['FIELD_sweetSpot.y']);
    expect(robotProfileIssues(at(59.5, 100.5)).map(i => i.code)).toEqual(['SWEET_SPOT_IN_HIVE', 'SWEET_SPOT_NO_SOLUTION']); // 조준점 12 in: 몸체도 HIVE, 해도 없음
    expect(robotProfileIssues(at(59.5, 108.5)).map(i => i.code)).toEqual(['SWEET_SPOT_NO_SOLUTION']);
    expect(robotProfileIssues(at(59.5, 139.5)).map(i => i.code)).toEqual(['SWEET_SPOT_OUT_OF_FIELD']);
    expect(robotProfileIssues({ ...at(59.5, 136.5), config: { ...r1.config, width: 6, length: 6 } })).toEqual([]); // 작은 로봇은 벽 가까이 가능
    // 다른 칸이 틀리면 탄도 검증은 하지 않음 (그 칸 오류만)
    expect(robotProfileIssues({ ...at(59.5, 100.5), config: { ...r1.config, width: 30 } }).map(i => i.code)).toEqual(['FIELD_width']);
    // 복사는 스윗스팟도 깊은 복사
    const src = at(40.5, 128.5);
    const copied = copyRobotProfile(src, DEFAULT_DRAFT_VALUES.robot2, 'robot2');
    expect(copied.ballistics.sweetSpot).toEqual({ x: 40.5, y: 128.5 });
    expect(copied.ballistics.sweetSpot).not.toBe(src.ballistics.sweetSpot);
  });

  it('K. (12-4) 확률표 생성 입력: 발사 가능 기물마다 그 기물 슈터의 탄도 설정', () => {
    const r1 = DEFAULT_DRAFT_VALUES.robot1;
    const card = { ...r1.ballistics.nectarShooter, dz: 30, shooterLateralOffset: -2 };
    const p = (setup: 'NONE' | 'POLLEN_ONLY' | 'SHARED' | 'PER_PIECE') => profileLUTShooters({ ...r1, config: { ...r1.config, shooterSetup: setup }, ballistics: { ...r1.ballistics, nectarShooter: card } });
    expect(p('SHARED')).toEqual({ POLLEN: profileBallisticsConfig(r1), NECTAR: profileBallisticsConfig(r1) });
    expect(p('POLLEN_ONLY')).toEqual({ POLLEN: profileBallisticsConfig(r1) });
    expect(p('NONE')).toEqual({});
    const per = p('PER_PIECE');
    expect(per.POLLEN).toEqual(profileBallisticsConfig(r1));
    expect([per.NECTAR?.dz, per.NECTAR?.shooterLateralOffset]).toEqual([30, -2]);
  });

  it('L. (13-3) 슈터 구성: 고를 수 있는 구성(NECTAR 흡입 불가면 NONE / SHARED만), 쓰는 슈터 자리, SHOOTER_SETUP_NECTAR', () => {
    expect(SHOOTER_SETUPS).toEqual(['NONE', 'POLLEN_ONLY', 'SHARED', 'PER_PIECE']);
    expect(SHOOTER_SETUPS.filter(v => shooterSetupAllowed(v, false))).toEqual(['NONE', 'SHARED']);
    expect(SHOOTER_SETUPS.every(v => shooterSetupAllowed(v, true))).toBe(true);
    expect(SHOOTER_SETUPS.map(usedShooterSlots)).toEqual([[], ['MAIN'], ['MAIN'], ['MAIN', 'NECTAR']]);
    const with_ = (setup: RobotProfile['config']['shooterSetup'], canIntakeNectar = true): RobotProfile => ({ ...r1, config: { ...r1.config, shooterSetup: setup, canIntakeNectar } });
    for (const setup of SHOOTER_SETUPS) expect(robotProfileIssues(with_(setup)), `${setup} default profile`).toEqual([]);
    expect(robotProfileIssues(with_('PER_PIECE', false)).map(i => i.code)).toEqual(['SHOOTER_SETUP_NECTAR']);
    expect(robotProfileIssues(with_('POLLEN_ONLY', false)).map(i => i.code)).toEqual(['SHOOTER_SETUP_NECTAR']);
    expect(robotProfileIssues(with_('SHARED', false))).toEqual([]);
    expect(robotProfileIssues(with_('BOTH' as never)).map(i => i.code)).toEqual(['FIELD_shooterSetup']);
  });

  it('M. (13-3) 새 칸: 좌우 오프셋 ±18 in, 리프트 주행 속도 0 ~ 200 in/s, NECTAR 슈터 카드(같은 항목 · 범위, 키 nectar.), 쓰는 슈터만 검사', () => {
    expect(parse('shooterLateralOffset', '-18')).toEqual({ ok: true, value: -18 });
    expect(parse('shooterLateralOffset', '18.5')).toMatchObject({ ok: false, error: { code: 'RANGE' } });
    expect(parse('liftMaxSpeed', '0')).toEqual({ ok: true, value: 0 });
    expect(parse('liftMaxSpeed', '200')).toEqual({ ok: true, value: 200 });
    expect(parse('liftMaxSpeed', '-1')).toMatchObject({ ok: false });
    expect(readNumber(writeNumber(r1, 'liftMaxSpeed', 30), 'liftMaxSpeed') === 30 && r1.config.liftMaxSpeed === 0).toBe(true);
    expect(readNumber(writeNumber(r1, 'shooterLateralOffset', 4), 'shooterLateralOffset') === 4 && r1.ballistics.shooterLateralOffset === 0).toBe(true);
    // NECTAR 카드: 주 슈터와 같은 항목 / 범위, 값 위치 = config.nectarShooter (조준 제원) / ballistics.nectarShooter (탄도)
    expect(SHOOTER_FIELD_KEYS.every(k => NUMBER_FIELDS[shooterFieldKey('NECTAR', k)] === NUMBER_FIELDS[k])).toBe(true);
    expect(shooterFieldKey('MAIN', 'launchHeight')).toBe('launchHeight');
    expect(shooterFieldKey('NECTAR', 'launchHeight')).toBe('nectar.launchHeight');
    let p = writeNumber(r1, 'nectar.shooterDelay', 450);
    p = writeNumber(p, 'nectar.launchHeight', 30);
    p = writeNumber(p, 'nectar.shooterLateralOffset', -3);
    p = writeNumber(writeNumber(p, 'nectar.turretLeft', -1), 'nectar.turretRight', 1);
    expect(p.config.nectarShooter).toEqual({ ...r1.config.nectarShooter, shooterDelay: 450, turretRange: [-1, 1] });
    expect([p.ballistics.nectarShooter.dz, p.ballistics.nectarShooter.shooterLateralOffset]).toEqual([30, -3]);
    expect(p.config.shooterDelay === r1.config.shooterDelay && p.ballistics.dz === r1.ballistics.dz).toBe(true); // 주 슈터는 그대로
    expect(readNumber(p, 'nectar.turretRight') === 1 && readNumber(p, 'nectar.shooterDelay') === 450).toBe(true);
    expect(slotAim(p, 'NECTAR')).toBe(p.config.nectarShooter);
    expect(slotBallistics(p, 'MAIN')).toBe(p.ballistics);
    expect(writeSlotAim(r1, 'NECTAR', { turretType: 'TURRET' }).config.nectarShooter.turretType).toBe('TURRET');
    expect(writeSlotAim(r1, 'MAIN', { turretType: 'TURRET' }).config.turretType).toBe('TURRET');
    // 쓰는 슈터만 검사: NECTAR 카드 칸은 PER_PIECE에서만, 주 슈터 칸은 NONE이면 보관만
    const badNectar = writeNumber(r1, 'nectar.shooterPitch', 1.6);
    expect(robotProfileIssues(badNectar)).toEqual([]); // SHARED: NECTAR 카드 미사용
    const per = (q: RobotProfile): RobotProfile => ({ ...q, config: { ...q.config, shooterSetup: 'PER_PIECE' } });
    expect(robotProfileIssues(per(badNectar)).map(i => i.code)).toEqual(['FIELD_nectar.shooterPitch']);
    const badMain = writeNumber(r1, 'shooterPitch', 1.6);
    expect(robotProfileIssues({ ...badMain, config: { ...badMain.config, shooterSetup: 'NONE' } })).toEqual([]);
    expect(robotProfileIssues(badMain).map(i => i.code)).toEqual(['FIELD_shooterPitch']);
    // NECTAR 터렛 폭 0 → TURRET_WIDTH (자리 NECTAR)
    const nectarTurret = per(writeSlotAim(r1, 'NECTAR', { turretType: 'TURRET', turretRange: [0.5, 0.5] }));
    expect(robotProfileIssues(nectarTurret).map(i => [i.code, i.slot])).toEqual([['TURRET_WIDTH', 'NECTAR']]);
  });

  it('N. (13-3) NECTAR 스윗스팟: 키 / 진영 기준 읽기 · 쓰기, 검증은 쓰는 슈터만 (자리 표시)', () => {
    expect(sweetSpotFieldKey('x')).toBe('sweetSpot.x');
    expect(sweetSpotFieldKey('y', 'NECTAR')).toBe('nectar.sweetSpot.y');
    const moved = writeSweetSpot(r1, 'BLUE', 'x', 90.2, 'NECTAR');
    expect(moved.ballistics.nectarShooter.sweetSpot).toEqual({ x: 53.5, y: 131.5 });
    expect(moved.ballistics.sweetSpot).toEqual(r1.ballistics.sweetSpot); // 주 슈터 그대로
    expect(readSweetSpot(moved, 'BLUE', 'NECTAR')).toEqual({ x: 90.5, y: 12.5 });
    const nectarAt = (x: number, y: number, setup: RobotProfile['config']['shooterSetup']): RobotProfile => ({
      ...r1,
      config: { ...r1.config, shooterSetup: setup },
      ballistics: { ...r1.ballistics, nectarShooter: { ...r1.ballistics.nectarShooter, sweetSpot: { x, y } } },
    });
    // SHARED / POLLEN_ONLY: NECTAR 스윗스팟은 쓰지 않으므로 틀려도 막지 않음
    expect(robotProfileIssues(nectarAt(59.5, 100.5, 'SHARED'))).toEqual([]);
    expect(robotProfileIssues(nectarAt(-1, 100.5, 'POLLEN_ONLY'))).toEqual([]);
    // PER_PIECE: 칸 범위 → 탄도 검증, 문제에 NECTAR 자리
    expect(robotProfileIssues(nectarAt(-1, 131.5, 'PER_PIECE')).map(i => i.code)).toEqual(['FIELD_nectar.sweetSpot.x']);
    expect(robotProfileIssues(nectarAt(59.5, 108.5, 'PER_PIECE')).map(i => [i.code, i.slot])).toEqual([['SWEET_SPOT_NO_SOLUTION', 'NECTAR']]);
    // NONE: 주 슈터 스윗스팟도 검사하지 않음
    const mainBad = { ...r1, config: { ...r1.config, shooterSetup: 'NONE' as const }, ballistics: { ...r1.ballistics, sweetSpot: { x: 59.5, y: 100.5 } } };
    expect(robotProfileIssues(mainBad)).toEqual([]);
    // 복사는 NECTAR 슈터도 깊은 복사
    const copied = copyRobotProfile(moved, DEFAULT_DRAFT_VALUES.robot2, 'robot2');
    expect(copied.ballistics.nectarShooter).toEqual(moved.ballistics.nectarShooter);
    expect(copied.ballistics.nectarShooter).not.toBe(moved.ballistics.nectarShooter);
    expect(copied.config.nectarShooter.turretRange).not.toBe(moved.config.nectarShooter.turretRange);
  });

  it('O. (13-3) 투입 방향 구역: 흡입 구역과 같은 칸 / 범위, 키 dropZone., 개수 0 ~ 8', () => {
    expect(zoneFieldKey(2, 'width', 'flowerDropZones')).toBe('dropZone.2.width');
    expect(zoneFieldKey(2, 'width')).toBe('zone.2.width');
    expect(isZoneFieldKey('dropZone.0.depth', 'flowerDropZones') && !isZoneFieldKey('zone.0.depth', 'flowerDropZones') && isZoneFieldKey('zone.0.depth', 'intakeZones')).toBe(true);
    const zone = newIntakeZone(r1.config);
    const withDrop = writeZone({ ...r1, config: { ...r1.config, flowerDropZones: [zone] } }, 0, { offset: 3 }, 'flowerDropZones');
    expect(withDrop.config.flowerDropZones).toEqual([{ ...zone, offset: 3 }]);
    expect(withDrop.config.intakeZones).toEqual(r1.config.intakeZones);
    expect(robotProfileIssues(withDrop)).toEqual([]);
    const offSide = writeZone(withDrop, 0, { offset: 10, width: 2 }, 'flowerDropZones'); // 가로 18 → ±9, 폭 최소 3.6
    expect(robotProfileIssues(offSide).map(i => i.code)).toEqual(['FIELD_dropZone.0.offset', 'FIELD_dropZone.0.width']);
    const many = { ...r1, config: { ...r1.config, flowerDropZones: Array.from({ length: MAX_INTAKE_ZONES + 1 }, () => zone) } };
    expect(robotProfileIssues(many).map(i => i.code)).toEqual(['DROP_ZONE_COUNT']);
  });

  it('P. (13-3) 미리보기 슈터: 쓰는 슈터마다 조준 범위 + 사출구(앞뒤 / 좌우 오프셋), 쏘는 기물', () => {
    expect(previewMuzzle({ shooterOffset: 5, shooterLateralOffset: -3 })).toEqual({ fwd: 5, right: -3 });
    const p = (setup: RobotProfile['config']['shooterSetup']): RobotProfile => ({
      ...r1,
      config: { ...r1.config, shooterSetup: setup },
      ballistics: { ...r1.ballistics, shooterOffset: 4, shooterLateralOffset: 2, nectarShooter: { ...r1.ballistics.nectarShooter, shooterOffset: -1, shooterLateralOffset: -5 } },
    });
    expect(previewShooters(p('NONE'))).toEqual([]);
    expect(previewShooters(p('SHARED')).map(s => [s.slot, s.pieces, s.muzzle])).toEqual([['MAIN', ['POLLEN', 'NECTAR'], { fwd: 4, right: 2 }]]);
    expect(previewShooters(p('POLLEN_ONLY')).map(s => s.pieces)).toEqual([['POLLEN']]);
    const per = previewShooters(p('PER_PIECE'));
    expect(per.map(s => [s.slot, s.pieces, s.muzzle])).toEqual([['MAIN', ['POLLEN'], { fwd: 4, right: 2 }], ['NECTAR', ['NECTAR'], { fwd: -1, right: -5 }]]);
    expect(per[1].aim).toBe(r1.config.nectarShooter);
  });
});
