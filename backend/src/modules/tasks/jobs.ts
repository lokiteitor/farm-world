// Manejadores de la cola que posee el modulo `tasks`.
//
// Andamiaje creado por W3-A con la firma definitiva. Propietario del contenido: W6-A.
//
// El registro de manejadores de `lib/advancePlayer.ts` esta predeclarado con los seis tipos de
// `ScheduledEventKind`, y `src/handlers.ts` conecta cada uno con el fichero del modulo que lo
// posee. Sustituir el cuerpo de esta funcion es por tanto todo lo que hace falta: ni el
// registro, ni la cola, ni el punto de avance se vuelven a tocar (plan seccion 11, regla 3).
//
// Contrato del manejador, que no cambia al implementarlo:
//
//   - Corre dentro de la transaccion del avance y despues de que el evento haya sido reclamado
//     con una actualizacion condicional, de modo que NO debe volver a comprobar el estado: si
//     esta funcion se ejecuta, este proceso gano la carrera y es el unico que la ejecuta.
//   - Todo efecto debe estar en esta transaccion. Encolar o publicar se hace registrando en
//     `context.outbox`, que se vacia despues del commit.
//   - Los sobres para el cliente se declaran con `context.emit(...)` y se escriben con el
//     instante de vencimiento del evento, no con el de proceso: un trabajo que corrio tarde
//     coloca el cambio donde ocurrio.
//   - Nada de `Date.now()`: el instante es `context.reading` y el vencimiento
//     `context.event.dueGameMs`.

import { type ScheduledEventHandler } from '../../lib/advancePlayer.js';
import {
  ScheduledEventKind,
  type ScheduledEventKind as ScheduledEventKindType,
} from '../../shared/index.js';

/** El tipo de evento agendado que posee este modulo. */
export const OWNED_EVENT_KIND: ScheduledEventKindType = ScheduledEventKind.TASK_COMPLETE;

/**
 * Manejador de `TASK_COMPLETE`: cierra la tarea, aplica su efecto y acredita la produccion (GDD §111).
 *
 * Andamiaje: no aplica ningun efecto y lo hace constar. El evento ya quedo marcado como
 * procesado por el punto de avance, asi que un andamiaje que fallara convertiria cada
 * vencimiento en un reintento indefinido de BullMQ; uno que registra el hueco deja la misma
 * traza que un tipo sin manejador y no bloquea la simulacion de los demas.
 */
export const taskCompleteHandler: ScheduledEventHandler = async (context) => {
  context.services.metrics.scheduledEventsUnhandled.inc({ kind: context.event.kind });
  context.services.logger.warn(
    {
      kind: context.event.kind,
      scheduledEventId: context.event.id,
      playerId: context.lock.playerId,
      owner: 'W6-A',
    },
    'andamiaje de manejador: el evento vencio y su modulo todavia no esta implementado',
  );
  await Promise.resolve();
};
