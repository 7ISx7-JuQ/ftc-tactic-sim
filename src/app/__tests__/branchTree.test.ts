// 분기 트리 규칙 (명세서 3.9 분기 트리, 10-5)
import { describe, expect, it } from 'vitest';
import {
  BRANCH_NAME_MAX_LENGTH,
  MAX_BRANCHES,
  branchDepth,
  canFork,
  createBranchTree,
  currentBranch,
  descendantIds,
  fileBranchName,
  forkBranch,
  normalizeName,
  removeBranch,
  renameBranch,
  setBranchData,
  switchBranch,
} from '../branchTree';
import type { BranchTree } from '../branchTree';

const fork = (tree: BranchTree<string>, tick: number, data: string) => forkBranch(tree, tick, data)!;

describe('분기 트리 규칙 (10-5)', () => {
  it('A. 원본 1개로 시작, 분기할 때마다 번호 2, 3, … 새 가지가 지금 가지, 원본 포함 8개까지', () => {
    let tree = createBranchTree('root');
    expect(tree.nodes).toEqual([{ id: 1, number: 1, name: null, parentId: null, forkTick: 0, data: 'root' }]);
    expect(currentBranch(tree).id).toBe(1);
    tree = fork(tree, 100, 'a');
    expect(currentBranch(tree)).toMatchObject({ number: 2, parentId: 1, forkTick: 100, data: 'a', name: null });
    tree = switchBranch(tree, 1);
    tree = fork(tree, 50, 'b');
    expect(currentBranch(tree)).toMatchObject({ number: 3, parentId: 1, forkTick: 50 });
    for (let i = tree.nodes.length; i < MAX_BRANCHES; i++) tree = fork(tree, i, `x${i}`);
    expect(tree.nodes).toHaveLength(8);
    expect(MAX_BRANCHES).toBe(8);
    expect(canFork(tree)).toBe(false);
    expect(forkBranch(tree, 1, 'full')).toBeNull();
    expect(createBranchTree('r', '  Loaded run ').nodes[0].name).toBe('Loaded run');
  });

  it('B. 이름: 앞뒤 공백 제거, 24자까지, 비우면 자동 이름(null)', () => {
    expect(normalizeName('  Fast cycle  ')).toBe('Fast cycle');
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName(null)).toBeNull();
    expect(normalizeName('x'.repeat(30))).toHaveLength(BRANCH_NAME_MAX_LENGTH);
    expect(normalizeName(`${'y'.repeat(23)}  z`)).toBe('y'.repeat(23)); // 자른 뒤 끝 공백도 제거
    let tree = fork(createBranchTree('r'), 10, 'a');
    tree = renameBranch(tree, 2, ' Plan B ');
    expect(tree.nodes[1].name).toBe('Plan B');
    expect(renameBranch(tree, 2, '').nodes[1].name).toBeNull();
    expect(renameBranch(tree, 99, 'none')).toEqual(tree);
  });

  it('C. 삭제: 하위 가지 포함, 원본 / 없는 가지 불가, 지금 가지가 지워지면 부모로, 번호는 재사용하지 않음', () => {
    // 1 ─ 2 ─ 3
    //   │   └ 5
    //   └ 4
    let tree = fork(createBranchTree('r'), 100, 'b2');
    tree = fork(tree, 200, 'b3');
    tree = fork(switchBranch(tree, 1), 50, 'b4');
    tree = fork(switchBranch(tree, 2), 150, 'b5');
    expect(descendantIds(tree, 2)).toEqual([3, 5]);
    expect(descendantIds(tree, 1)).toEqual([2, 3, 4, 5]);
    expect([1, 2, 3, 4, 5].map(id => branchDepth(tree, id))).toEqual([0, 1, 2, 1, 2]);
    expect(removeBranch(tree, 1)).toBeNull();
    expect(removeBranch(tree, 42)).toBeNull();

    const cut = removeBranch(tree, 2)!; // 지금 가지 5는 2의 하위 → 부모 1로
    expect(cut.tree.nodes.map(n => n.id)).toEqual([1, 4]);
    expect(cut.removed.map(n => n.id)).toEqual([2, 3, 5]);
    expect(cut.tree.currentId).toBe(1);
    const toParent = removeBranch(switchBranch(tree, 3), 3)!; // 지금 가지 3 삭제 → 부모 2 (원본이 아님)
    expect(toParent.tree.currentId).toBe(2);
    const keep = removeBranch(switchBranch(tree, 4), 3)!; // 지금 가지 4는 그대로
    expect(keep.tree.currentId).toBe(4);
    expect(keep.tree.nodes.map(n => n.id)).toEqual([1, 2, 4, 5]);
    // 지운 뒤 새 가지: 번호 6 (재사용 없음), id도 겹치지 않음
    const again = fork(cut.tree, 10, 'b6');
    expect(currentBranch(again)).toMatchObject({ number: 6, parentId: 1 });
    expect(new Set(again.nodes.map(n => n.id)).size).toBe(again.nodes.length);
  });

  it('D. 불변 값: 바꾸는 함수는 새 트리를 돌려주고 원래 트리는 그대로', () => {
    const tree = fork(createBranchTree('r'), 10, 'a');
    const snapshot = JSON.stringify(tree);
    setBranchData(tree, 1, 'changed');
    switchBranch(tree, 1);
    renameBranch(tree, 1, 'x');
    removeBranch(tree, 2);
    forkBranch(tree, 5, 'b');
    expect(JSON.stringify(tree)).toBe(snapshot);
    expect(setBranchData(tree, 1, 'changed').nodes[0].data).toBe('changed');
    expect(switchBranch(tree, 99)).toBe(tree);
  });

  it('E. 파일에 쓸 가지 이름: 사용자 이름, 없으면 원본 Main / Branch n', () => {
    expect(fileBranchName({ name: null, number: 1, parentId: null })).toBe('Main');
    expect(fileBranchName({ name: null, number: 3, parentId: 1 })).toBe('Branch 3');
    expect(fileBranchName({ name: 'Plan B', number: 3, parentId: 1 })).toBe('Plan B');
  });
});
