// 로봇 제원 탭 폼 규칙 (명세서 3.8 로봇 제원 탭, 09-9a)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_VALUES } from '../../app/defaultSetup';
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
} from '../robotForm';

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
    expect(parse('aimTolerance', '45')).toEqual({ ok: true, value: Math.PI / 4 });
    expect(parse('aimTolerance', '45.1')).toMatchObject({ ok: false, error: { code: 'RANGE' } });
    expect(parse('aimTolerance', '0.05')).toMatchObject({ ok: false, error: { code: 'RANGE' } });
    expect(parse('turretLeft', '-180')).toEqual({ ok: true, value: -Math.PI });
    expect(parse('turretRight', '180')).toEqual({ ok: true, value: Math.PI });
    expect(parse('maxTurnRate', '4')).toEqual({ ok: true, value: 4 }); // rad/s 그대로
    expect(parse('maxSpeed', '152.4', 'cm')).toEqual({ ok: true, value: 60 });
  });

  it('C. 엔진 값 → 표시 (in / cm, °, 개수)', () => {
    expect(formatField(NUMBER_FIELDS.width, 18, 'in')).toBe('18.00');
    expect(formatField(NUMBER_FIELDS.width, 18, 'cm')).toBe('45.72');
    expect(formatField(NUMBER_FIELDS.aimTolerance, (3 * Math.PI) / 180, 'in')).toBe('3.0');
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
    expect(previewAimSector({ turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.1 })).toEqual({ start: -0.1, end: 0.1 });
    expect(previewAimSector({ turretType: 'TURRET', turretRange: [-1, 1], aimTolerance: 0.1 })).toEqual({ start: -1, end: 1 });
    expect(previewAimSector({ turretType: 'TURRET', turretRange: [2.5, -2.5], aimTolerance: 0.1 })).toEqual({ start: 2.5, end: -2.5 + 2 * Math.PI }); // 후방
  });
});
