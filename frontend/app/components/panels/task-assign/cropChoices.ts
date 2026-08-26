// Las sesenta y dos opciones de siembra, agrupadas y decididas.
//
// Propietario: W5-F. Lo lee el panel de asignacion y su suite.
//
// Un modulo puro y no un `computed` dentro del panel, por la misma razon que
// `panels/shared/assignment.ts` existe: lo que decide si una opcion se puede elegir es una
// regla, y una regla dentro de una plantilla no se puede probar sin montar el componente.
//
// El motivo de un rechazo es un `ValidationCode` y nunca una frase escrita aqui (ADR-0032).
// El panel lo pinta con el mismo `reasonOf` que ya usa para las combinaciones de maquinaria,
// y la frase sale de la tabla compartida, que es la misma que el servidor devolvera si la
// peticion llega igualmente.

import {
  CROP_FAMILY_LABELS,
  CROP_LABELS,
  SEASON_LABELS,
} from '~/components/panels/legend/vocabulary';
import { cropBlockingCode } from '~/components/panels/shared/assignment';
import {
  CROPS,
  CROP_FAMILIES,
  CROP_IDS,
  type CropFamily,
  type CropId,
  type Season,
  type ValidationCode,
} from '~/shared/index';

export interface CropChoice {
  readonly cropId: CropId;
  readonly label: string;
  /** Si se puede sembrar ahora mismo. */
  readonly usable: boolean;
  /** El codigo que lo impide, o null. */
  readonly code: ValidationCode | null;
  /** Las estaciones en que si se siembra, ya en castellano, para el sufijo de la opcion. */
  readonly seasons: string;
}

export interface CropGroup {
  readonly family: CropFamily;
  readonly label: string;
  readonly options: readonly CropChoice[];
}

/**
 * Los cultivos del catalogo, por familia y en el orden del catalogo.
 *
 * Los que estan fuera de temporada aparecen igual, deshabilitados y con su motivo: que un
 * cultivo exista y hoy no se pueda sembrar es informacion que el jugador necesita para
 * planificar, y esconderlo lo convertiria en un cultivo que no existe.
 *
 * `familyFilter` no quita opciones del catalogo, solo acota lo que se muestra: con sesenta
 * y dos, elegir empieza por reducir.
 */
export function cropGroups(
  season: Season,
  familyFilter: CropFamily | null = null,
): readonly CropGroup[] {
  return CROP_FAMILIES.filter((family) => familyFilter === null || family === familyFilter)
    .map((family) => ({
      family,
      label: CROP_FAMILY_LABELS[family],
      options: CROP_IDS.filter((cropId) => CROPS[cropId].family === family).map(
        (cropId): CropChoice => {
          const code = cropBlockingCode('SEED', cropId, season);
          return {
            cropId,
            label: CROP_LABELS[cropId],
            usable: code === null,
            code,
            seasons: CROPS[cropId].sowingSeasons.map((each) => SEASON_LABELS[each]).join(', '),
          };
        },
      ),
    }))
    .filter((group) => group.options.length > 0);
}

/**
 * El primer cultivo sembrable en la estacion vigente, o null si no hay ninguno.
 *
 * Es lo que el panel ofrece por omision. Antes era `Object.keys(CROPS)[0]`, que con un solo
 * cultivo era el trigo y con sesenta y dos seria el maiz aunque estuviese fuera de
 * temporada: proponer algo que el servidor va a rechazar.
 */
export function firstSowableCrop(season: Season): CropId | null {
  return CROP_IDS.find((cropId) => CROPS[cropId].sowingSeasons.includes(season)) ?? null;
}
