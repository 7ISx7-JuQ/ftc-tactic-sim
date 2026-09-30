// 분기 트리 규칙 (명세서 3.9 분기 트리, 10-5): React / 엔진 비의존 순수 함수. 가지마다 붙는 자료(타임라인 / 입력 기록)는 T로 받는다.
// - 원본 가지(번호 1) + 분기할 때마다 새 가지(번호 2, 3, … 경기 안에서 재사용 없음). 최대 MAX_BRANCHES개 (원본 포함).
// - 이름: null = 자동 이름(원본 Main / 가지 Branch n, 화면 문구는 10-6), 바꾸기 = 앞뒤 공백 제거 1 ~ 24자, 비우면 자동 이름.
// - 삭제 = 그 가지 + 모든 하위 가지, 원본은 삭제 불가. 지금 가지가 지워지면 지운 가지의 부모로.
// 트리는 불변 값으로 다룬다 (바꾸는 함수는 새 트리를 돌려준다).

export const MAX_BRANCHES = 8;
export const BRANCH_NAME_MAX_LENGTH = 24;

export interface BranchNode<T> {
  id: number;
  number: number;           // 표시 번호 (원본 1, 이후 2, 3, …)
  name: string | null;      // 사용자 이름 (null = 자동 이름)
  parentId: number | null;  // 원본 = null
  forkTick: number;         // 부모에서 갈라진 틱 (원본 = 0)
  data: T;
}

export interface BranchTree<T> {
  nodes: readonly BranchNode<T>[]; // 만든 순서
  currentId: number;
  nextNumber: number;
}

export function createBranchTree<T>(rootData: T, rootName: string | null = null): BranchTree<T> {
  return { nodes: [{ id: 1, number: 1, name: normalizeName(rootName), parentId: null, forkTick: 0, data: rootData }], currentId: 1, nextNumber: 2 };
}

export const findBranch = <T>(tree: BranchTree<T>, id: number): BranchNode<T> | undefined => tree.nodes.find(n => n.id === id);
export const currentBranch = <T>(tree: BranchTree<T>): BranchNode<T> => findBranch(tree, tree.currentId)!;
export const canFork = <T>(tree: BranchTree<T>): boolean => tree.nodes.length < MAX_BRANCHES;

/** 새 가지: 지금 가지에서 forkTick에 갈라져 지금 가지가 된다. 가득 찼으면 null */
export function forkBranch<T>(tree: BranchTree<T>, forkTick: number, data: T): BranchTree<T> | null {
  if (!canFork(tree)) return null;
  const id = Math.max(...tree.nodes.map(n => n.id)) + 1;
  const node: BranchNode<T> = { id, number: tree.nextNumber, name: null, parentId: tree.currentId, forkTick, data };
  return { nodes: [...tree.nodes, node], currentId: id, nextNumber: tree.nextNumber + 1 };
}

/** 가지 자료 교체 (지금 가지를 떠날 때 입력 기록 사본 보관 등) */
export function setBranchData<T>(tree: BranchTree<T>, id: number, data: T): BranchTree<T> {
  return { ...tree, nodes: tree.nodes.map(n => (n.id === id ? { ...n, data } : n)) };
}

/** 지금 가지 바꾸기 (없는 가지면 그대로) */
export function switchBranch<T>(tree: BranchTree<T>, id: number): BranchTree<T> {
  return findBranch(tree, id) ? { ...tree, currentId: id } : tree;
}

/** 이름: 앞뒤 공백 제거, 24자까지, 비면 null (자동 이름) */
export function normalizeName(name: string | null): string | null {
  const trimmed = (name ?? '').trim().slice(0, BRANCH_NAME_MAX_LENGTH).trim();
  return trimmed === '' ? null : trimmed;
}

export function renameBranch<T>(tree: BranchTree<T>, id: number, name: string | null): BranchTree<T> {
  return { ...tree, nodes: tree.nodes.map(n => (n.id === id ? { ...n, name: normalizeName(name) } : n)) };
}

/** 하위 가지 id (자식, 손자, … 만든 순서) */
export function descendantIds<T>(tree: BranchTree<T>, id: number): number[] {
  const out: number[] = [];
  for (const n of tree.nodes) {
    if (n.parentId !== null && (n.parentId === id || out.includes(n.parentId))) out.push(n.id);
  }
  return out;
}

/** 원본 → 가지까지의 깊이 (원본 = 0) */
export function branchDepth<T>(tree: BranchTree<T>, id: number): number {
  let depth = 0;
  for (let n = findBranch(tree, id); n && n.parentId !== null; n = findBranch(tree, n.parentId)) depth++;
  return depth;
}

/**
 * 삭제: 그 가지 + 하위 가지. 원본 / 없는 가지는 null. 지금 가지가 지워지면 지운 가지의 부모가 지금 가지.
 * removed = 지운 가지들 (자료 정리용)
 */
export function removeBranch<T>(tree: BranchTree<T>, id: number): { tree: BranchTree<T>; removed: BranchNode<T>[] } | null {
  const target = findBranch(tree, id);
  if (!target || target.parentId === null) return null;
  const gone = new Set([id, ...descendantIds(tree, id)]);
  const currentId = gone.has(tree.currentId) ? target.parentId : tree.currentId;
  return {
    tree: { nodes: tree.nodes.filter(n => !gone.has(n.id)), currentId, nextNumber: tree.nextNumber },
    removed: tree.nodes.filter(n => gone.has(n.id)),
  };
}

/** 파일에 쓸 가지 이름 (언어와 무관한 영어 자동 이름: 원본 Main / Branch n) */
export function fileBranchName(node: Pick<BranchNode<unknown>, 'name' | 'number' | 'parentId'>): string {
  return node.name ?? (node.parentId === null ? 'Main' : `Branch ${node.number}`);
}
