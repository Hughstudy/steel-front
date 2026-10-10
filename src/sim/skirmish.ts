import type { MapConfig } from '../types.ts';
import type { MapPreset, Rules, ScenarioDef } from './rules.ts';

/** What a match was started from; saved with the match so the map can be regenerated. */
export type MatchSetup =
  | { kind: 'skirmish'; map: string; faction: string; difficulty: string }
  | { kind: 'scenario'; id: string; difficulty: string };

/** Base map config with a preset's name, seed, generator overrides and palette applied. */
export function mapConfigFor(base: MapConfig, preset: MapPreset): MapConfig {
  return {
    ...base,
    name: preset.name,
    subtitle: preset.subtitle,
    seed: preset.seed,
    spawn: preset.spawns[0],
    generation: { ...(base.generation as Record<string, unknown>), ...preset.generation },
    palette: { ...base.palette, ...preset.palette },
  };
}

/** The opposing faction: the first other faction in data order. */
export function opponentOf(rules: Rules, faction: string): string {
  for (const id of rules.factions.keys()) if (id !== faction) return id;
  return faction;
}

/** A normal match: the player at spawn 0 against a computer opponent at spawn 1. */
export function skirmishScenario(rules: Rules, map: string, faction: string, difficulty: string): ScenarioDef {
  const preset = rules.maps.get(map);
  if (!preset || !rules.skirmish.maps.includes(map)) throw new Error(`Unknown skirmish map ${map}`);
  if (!rules.skirmish.start.has(faction)) throw new Error(`Unknown faction ${faction}`);
  if (!rules.ai.difficulties.has(difficulty)) throw new Error(`Unknown difficulty ${difficulty}`);
  const enemy = opponentOf(rules, faction);
  const credits = rules.skirmish.credits;
  const [home, away] = preset.spawns;
  return {
    id: `skirmish-${map}`,
    name: `Skirmish · ${preset.name}`,
    description: `Deploy your MCV, build a base and destroy the enemy ${rules.factions.get(enemy)!.name} headquarters. Lose your MCV before deploying, or your HQ afterwards, and the battle is lost.`,
    map,
    camera: { x: home.x, y: home.y },
    resources: true,
    fog: true,
    victory: true,
    players: [
      { faction, credits, anchor: home, units: rules.skirmish.start.get(faction)!, buildings: [], ai: '' },
      { faction: enemy, credits, anchor: away, units: rules.skirmish.start.get(enemy)!, buildings: [], ai: difficulty },
    ],
  };
}

/** Scenario and map preset for a setup (development scenarios keep their own map). */
export function scenarioFor(rules: Rules, setup: MatchSetup): ScenarioDef {
  if (setup.kind === 'skirmish') return skirmishScenario(rules, setup.map, setup.faction, setup.difficulty);
  const scenario = rules.scenarios.get(setup.id);
  if (!scenario) throw new Error(`Unknown scenario ${setup.id}`);
  return scenario;
}
