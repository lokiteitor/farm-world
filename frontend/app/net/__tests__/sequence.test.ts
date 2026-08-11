// The sequence rule and the resynchronisation ladder.
//
// Owner: W3-C.
//
// These are the tests of the one property the whole synchronisation design rests on, so they
// are written against the boundary and not against the happy path: the case that matters is
// `oldestReplaySeq === lastAppliedSeq + 1`, where the ring holds exactly the first missing
// frame, because getting that comparison wrong produces the worst failure this design can
// have, a client that believes it caught up while a frame is missing for good.

import { describe, expect, it } from 'vitest';
import {
  FrameVerdict,
  ResyncAction,
  consumesSequence,
  decideFrame,
  decideMutationReply,
  nextResyncStep,
} from '~/net/sequence';

describe('la regla de secuencia', () => {
  it('aplica la trama que sigue a la marca', () => {
    expect(decideFrame(7, { seq: 8, type: 'FIELD_UPSERTED' })).toBe(FrameVerdict.APPLY);
  });

  it('descarta la trama ya aplicada y la anterior', () => {
    expect(decideFrame(7, { seq: 7, type: 'FIELD_UPSERTED' })).toBe(FrameVerdict.DISCARD);
    expect(decideFrame(7, { seq: 3, type: 'FIELD_UPSERTED' })).toBe(FrameVerdict.DISCARD);
  });

  it('detecta el hueco cuando la trama va mas de uno por delante', () => {
    expect(decideFrame(7, { seq: 9, type: 'FIELD_UPSERTED' })).toBe(FrameVerdict.GAP);
  });

  it('trata CLOCK y HELLO como transporte, sin mover la marca', () => {
    expect(consumesSequence('CLOCK')).toBe(false);
    expect(consumesSequence('HELLO')).toBe(false);
    expect(consumesSequence('PLAYER_UPSERTED')).toBe(true);
    // Una lectura de reloj durante un hueco no lo cierra ni lo empeora.
    expect(decideFrame(7, { seq: 12, type: 'CLOCK' })).toBe(FrameVerdict.APPLY_TRANSPORT);
    expect(decideFrame(7, { seq: 2, type: 'HELLO' })).toBe(FrameVerdict.APPLY_TRANSPORT);
  });

  it('admite un salto en la respuesta de una ruta mutante', () => {
    // Una mutacion puede producir varias tramas, de modo que su `seq` va por delante de la
    // marca por mas de uno y eso no es un hueco: cada entidad es un reemplazo completo.
    expect(decideMutationReply(7, 11)).toBe(FrameVerdict.APPLY);
    expect(decideMutationReply(7, 7)).toBe(FrameVerdict.DISCARD);
    expect(decideMutationReply(7, 6)).toBe(FrameVerdict.DISCARD);
  });
});

describe('la escalera de resincronizacion', () => {
  it('no hace nada cuando no falta nada', () => {
    const step = nextResyncStep({ lastAppliedSeq: 9, currentSeq: 9, oldestReplaySeq: 1 });
    expect(step.action).toBe(ResyncAction.NONE);
  });

  it('reproduce desde el anillo cuando el anillo cubre la primera trama que falta', () => {
    const step = nextResyncStep({ lastAppliedSeq: 9, currentSeq: 14, oldestReplaySeq: 10 });
    expect(step.action).toBe(ResyncAction.REPLAY);
    expect(step.sinceSeq).toBe(9);
  });

  it('pide instantanea cuando el hueco empieza por debajo del anillo', () => {
    const step = nextResyncStep({ lastAppliedSeq: 9, currentSeq: 40, oldestReplaySeq: 11 });
    expect(step.action).toBe(ResyncAction.SNAPSHOT);
  });

  it('pide instantanea cuando la reproduccion vino truncada', () => {
    const step = nextResyncStep({
      lastAppliedSeq: 9,
      currentSeq: 14,
      oldestReplaySeq: 10,
      truncated: true,
    });
    expect(step.action).toBe(ResyncAction.SNAPSHOT);
  });

  it('desemboca en hueco, reproduccion y despues instantanea', () => {
    // La secuencia completa que el plan describe: la trama abre el hueco, el anillo lo cubre
    // y responde truncado, y el unico camino restante es la instantanea completa.
    expect(decideFrame(9, { seq: 14, type: 'TASK_UPSERTED' })).toBe(FrameVerdict.GAP);

    const first = nextResyncStep({ lastAppliedSeq: 9, currentSeq: 14, oldestReplaySeq: 10 });
    expect(first.action).toBe(ResyncAction.REPLAY);

    const afterTruncatedReplay = nextResyncStep({
      lastAppliedSeq: 9,
      currentSeq: 14,
      oldestReplaySeq: 12,
      truncated: true,
    });
    expect(afterTruncatedReplay.action).toBe(ResyncAction.SNAPSHOT);
  });
});
