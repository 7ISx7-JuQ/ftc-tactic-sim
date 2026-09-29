// 로봇 제원 탭 폼 규칙 (명세서 3.8 로봇 제원 탭, 09-9a)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_VALUES } from '../../app/defaultSetup';
import {
  NUMBER_FIELDS,
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
    const source = { teamNumber: '19049', teamName: 'Bees', config: { ...r1.config, width: 14, maxSpeed: 80 } };
    const target = { ...DEFAULT_DRAFT_VALUES.robot2, teamNumber: '24909', teamName: 'Hornets' };
    const copied = copyRobotProfile(source, target, 'robot2');
    expect(copied.teamNumber === '24909' && copied.teamName === 'Hornets').toBe(true);
    expect(copied.config).toEqual({ ...source.config, id: 'robot2', name: 'R2' });
    copied.config.intakeZones[0].width = 1;
    expect(source.config.intakeZones[0].width).toBe(18);
  });
});
