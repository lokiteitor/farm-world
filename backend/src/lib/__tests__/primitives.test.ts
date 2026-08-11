// The pure primitives of the infrastructure: keys, the storm guard, the delay and the day counter.
//
// Owner: workflow W3-A (backend skeleton).
//
// None of these needs a database, and all four are rules rather than plumbing, which is why they are
// tested apart from the integration suite: they are the pieces whose behaviour every later workflow
// will assume without reading the implementation.

import { describe, expect, it } from 'vitest';
import { keyBuilders } from '../../plugins/redis.js';
import { missingRouteKeys } from '../../plugins/routes.js';
import {
  API_ROUTE_KEYS,
  INITIAL_ANCHOR_GAME_MS,
  LedgerType,
  MS_PER_GAME_HOUR,
  SCHEDULE_HORIZON_REAL_MS,
  ScheduledEventKind,
  gameMs as toGameMsValue,
  realMs as toRealMsValue,
  worldId as toWorldId,
  type PlayerId,
  type World,
  type WsServerFrame,
} from '../../shared/index.js';
import { type ClockReading } from '../gameClock.js';
import {
  accrualKey,
  hashRequestBody,
  hashToken,
  newOpaqueToken,
  periodicJobId,
  scheduledEventDedupeKey,
  scheduledJobId,
  startingCapitalKey,
} from '../ids.js';
import { dayNumberOf } from '../playerView.js';
import { parseChannelMessage, playerOfChannel, selectLiveFrames } from '../pubsub.js';
import { ParkReason, delayFor } from '../scheduler.js';

const PLAYER = '019ff2d6-fcde-7010-85fa-803b113e77cd' as PlayerId;

/** A reading built by hand, so the delay can be computed for any rate. */
function readingWith(rateNum: number, atGameOffsetHours = 0): ClockReading {
  const anchorRealMs = toRealMsValue(1_800_000_000_000n);
  const world: World = {
    id: toWorldId('019ff2d6-fcde-7010-85fa-803b113e77cd'),
    seed: 1,
    generatorVersion: 1,
    chunkSize: 32,
    createdAtRealMs: anchorRealMs,
    anchorGameMs: INITIAL_ANCHOR_GAME_MS,
    anchorRealMs,
    rateNum,
    rateDen: 1,
    scheduleEpoch: 0,
  };
  const offset = BigInt(atGameOffsetHours) * MS_PER_GAME_HOUR;
  return {
    world,
    atRealMs: toRealMsValue(anchorRealMs + (rateNum === 0 ? 0n : offset / BigInt(rateNum))),
    gameNow: toGameMsValue(INITIAL_ANCHOR_GAME_MS + offset),
    paused: rateNum === 0,
  };
}

describe('las claves deterministas', () => {
  it('llevan el intervalo en la clave del devengo, que es lo que evita el doble cobro', () => {
    const from = toGameMsValue(3_456_000_000n);
    expect(accrualKey(PLAYER, LedgerType.WORKER_WAGES, from)).toBe(
      `accrual:${PLAYER}:WORKER_WAGES:3456000000`,
    );
    // Two windows of the same player and kind differ, and the same window does not.
    expect(accrualKey(PLAYER, LedgerType.WORKER_WAGES, from)).toBe(
      accrualKey(PLAYER, LedgerType.WORKER_WAGES, from),
    );
    expect(accrualKey(PLAYER, LedgerType.WORKER_WAGES, toGameMsValue(from + 1n))).not.toBe(
      accrualKey(PLAYER, LedgerType.WORKER_WAGES, from),
    );
  });

  it('nombra el capital inicial igual que la semilla', () => {
    expect(startingCapitalKey(PLAYER)).toBe(`starting-capital:${PLAYER}`);
  });

  it('lleva el epoch en el identificador del trabajo', () => {
    expect(scheduledJobId('abc', 0)).toBe('evt:abc:0');
    // A re-anchoring increments the epoch, so the jobs of the previous one are a different set and
    // can be removed without touching the new ones.
    expect(scheduledJobId('abc', 1)).not.toBe(scheduledJobId('abc', 0));
    expect(periodicJobId('sim.reconcile', 7)).toBe('cron:sim.reconcile:7');
  });

  it('describe el hecho en la clave de deduplicacion, no el instante', () => {
    expect(scheduledEventDedupeKey(ScheduledEventKind.TASK_COMPLETE, 'task-1')).toBe(
      'TASK_COMPLETE:task-1',
    );
    expect(scheduledEventDedupeKey(ScheduledEventKind.PLAYER_SETTLE_SWEEP, PLAYER, '123')).toBe(
      `PLAYER_SETTLE_SWEEP:${PLAYER}:123`,
    );
  });
});

describe('los tokens opacos', () => {
  it('produce valores distintos y un hash estable', () => {
    const left = newOpaqueToken();
    const right = newOpaqueToken();
    expect(left).not.toBe(right);
    // 32 bytes in base64url are 43 characters with no padding.
    expect(left).toHaveLength(43);
    expect(hashToken(left)).toBe(hashToken(left));
    expect(hashToken(left)).not.toBe(hashToken(right));
    expect(hashToken(left)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distingue dos cuerpos de peticion y no distingue el mismo', () => {
    const left = hashRequestBody('POST', '/api/market/sell', { quantityUnits: 10 });
    const same = hashRequestBody('POST', '/api/market/sell', { quantityUnits: 10 });
    const other = hashRequestBody('POST', '/api/market/sell', { quantityUnits: 11 });
    const otherRoute = hashRequestBody('POST', '/api/land/purchase', { quantityUnits: 10 });
    expect(left).toBe(same);
    expect(left).not.toBe(other);
    expect(left).not.toBe(otherRoute);
  });
});

describe('la guarda de tormenta del canal en vivo', () => {
  const frame = (seq: number): WsServerFrame =>
    ({ seq, atGameMs: '0', type: 'NOTICE', payload: {} }) as unknown as WsServerFrame;

  it('deja pasar un lote pequeno tal cual', () => {
    const frames = [frame(1), frame(2), frame(3)];
    expect(selectLiveFrames(frames, 10)).toEqual(frames);
  });

  it('colapsa un lote grande en el ultimo sobre, que lleva la secuencia mas alta', () => {
    const frames = Array.from({ length: 40 }, (_value, index) => frame(index + 1));
    const live = selectLiveFrames(frames, 10);
    // Dropping frames from the live channel is safe by design: the client sees a gap and replays
    // once, which is one request instead of forty frames (plan section 7).
    expect(live).toHaveLength(1);
    expect(live[0]?.seq).toBe(40);
  });

  it('no publica nada cuando no hay nada', () => {
    expect(selectLiveFrames([], 10)).toEqual([]);
  });
});

describe('el canal por jugador', () => {
  const keys = keyBuilders('farm-world-test');

  it('deriva el jugador del nombre del canal', () => {
    expect(playerOfChannel(keys, keys.playerChannel(PLAYER))).toBe(PLAYER);
    expect(playerOfChannel(keys, 'otra:cosa')).toBe(null);
  });

  it('descarta un mensaje ilegible en lugar de fallar', () => {
    expect(parseChannelMessage('{')).toBe(null);
    expect(parseChannelMessage('null')).toBe(null);
    expect(parseChannelMessage('{"seq":1}')).toBe(null);
    expect(parseChannelMessage('{"seq":1,"type":"NOTICE"}')).not.toBe(null);
  });
});

describe('el retardo de un despertador', () => {
  it('es cero para un evento ya vencido', () => {
    const reading = readingWith(1, 10);
    const outcome = delayFor(
      reading,
      toGameMsValue(reading.gameNow - 1n),
      SCHEDULE_HORIZON_REAL_MS,
    );
    expect(outcome).toEqual({ delayRealMs: 0 });
  });

  it('es la distancia en tiempo real para un evento dentro del horizonte', () => {
    const reading = readingWith(1);
    const oneHourAhead = toGameMsValue(reading.gameNow + MS_PER_GAME_HOUR);
    const outcome = delayFor(reading, oneHourAhead, SCHEDULE_HORIZON_REAL_MS);
    expect(outcome).toEqual({ delayRealMs: Number(MS_PER_GAME_HOUR) });
  });

  it('aparca lo que cae mas alla del horizonte', () => {
    const reading = readingWith(1);
    const farAhead = toGameMsValue(reading.gameNow + 48n * MS_PER_GAME_HOUR);
    expect(delayFor(reading, farAhead, SCHEDULE_HORIZON_REAL_MS)).toEqual({
      park: ParkReason.BEYOND_HORIZON,
    });
  });

  it('aparca todo con el mundo pausado, porque el instante no llega nunca', () => {
    const reading = readingWith(0);
    const ahead = toGameMsValue(reading.gameNow + MS_PER_GAME_HOUR);
    expect(delayFor(reading, ahead, SCHEDULE_HORIZON_REAL_MS)).toEqual({
      park: ParkReason.WORLD_PAUSED,
    });
  });

  it('escala con el multiplicador: al doble de velocidad, la mitad de espera real', () => {
    const reading = readingWith(2);
    const oneHourAhead = toGameMsValue(reading.gameNow + MS_PER_GAME_HOUR);
    expect(delayFor(reading, oneHourAhead, SCHEDULE_HORIZON_REAL_MS)).toEqual({
      delayRealMs: Number(MS_PER_GAME_HOUR / 2n),
    });
  });
});

describe('el dia del jugador', () => {
  it('empieza en uno y avanza cada veinticuatro horas de juego', () => {
    const start = toGameMsValue(INITIAL_ANCHOR_GAME_MS);
    expect(dayNumberOf(start, start)).toBe(1);
    expect(dayNumberOf(start, toGameMsValue(start + 23n * MS_PER_GAME_HOUR))).toBe(1);
    expect(dayNumberOf(start, toGameMsValue(start + 24n * MS_PER_GAME_HOUR))).toBe(2);
    expect(dayNumberOf(start, toGameMsValue(start + 325n * MS_PER_GAME_HOUR))).toBe(14);
    // It is the player's own day and not the world's, so an instant before the start is still day
    // one rather than a negative number.
    expect(dayNumberOf(toGameMsValue(start + MS_PER_GAME_HOUR), start)).toBe(1);
  });
});

describe('la comprobacion de completitud del registro', () => {
  it('nombra exactamente lo que falta', () => {
    const all = [...API_ROUTE_KEYS];
    expect(missingRouteKeys(all, API_ROUTE_KEYS)).toEqual([]);
    const withoutTwo = all.slice(2);
    expect(missingRouteKeys(withoutTwo, API_ROUTE_KEYS)).toEqual(all.slice(0, 2));
  });
});
