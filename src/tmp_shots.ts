import { SimulationEngine } from './core/simulationEngine';
import type { RobotDriveInput } from './core/simulationEngine';
import { DEV_ROBOT_CONFIGS } from './dev/devSetup';
import { renderScene } from './renderer/sceneRenderer';
import { restingView } from './renderer/viewTransform';

const { robot1, robot2 } = DEV_ROBOT_CONFIGS;
const IDLE: RobotDriveInput = { targetVx: 0, targetVy: 0, targetOmega: 0, actionState: 'IDLE' };
const e = new SimulationEngine(robot1, robot2, () => 1, 'RED', { allianceColor: 'RED', r1Loadout: [], r2Spawn: { x: 9, y: 107.5, heading: 0 }, rngSeed: 11 });
let f = e.getFrame(0)!;
for (let t = 0; t < 120; t++) f = e.step({ targetVx: 30, targetVy: 10, targetOmega: 0.5, actionState: 'INTAKING' }, { ...IDLE, actionState: 'FLOWER_SETUP' });
const make = (id: string, w: number, dpr: number) => {
  const c = document.createElement('canvas');
  c.id = id; c.width = w; c.height = w; c.style.width = `${w}px`; c.style.height = `${w}px`;
  document.getElementById('scenes')!.appendChild(c);
  renderScene(c.getContext('2d')!, { frame: f, r1Config: robot1, r2Config: robot2, view: restingView('DRIVER', 'RED') }, dpr);
};
make('badges', 800, 1);
document.title = `${f.r1.actionState} / ${f.r2.actionState}`;
