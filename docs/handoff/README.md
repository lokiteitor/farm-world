# Notas de traspaso entre agentes

Estado: vigente desde la ventana de parcheo de W2.5.

Este directorio existe por la quinta regla de la ejecucion en paralelo: ningun agente ejecuta ordenes
que muten el repositorio fuera de su ambito, y ninguno modifica un fichero congelado. Cuando un agente
necesita algo que no puede hacer, no lo hace: lo anota aqui y sigue adelante con un stub.

## 1. Un fichero por agente

Cada agente escribe exclusivamente en `NOTES-<agente>.md`, con el identificador que le asigna
`docs/ownership.md` (por ejemplo `NOTES-W1.md`, `NOTES-W4-C.md`). Un fichero por agente no puede
colisionar con el de otro, que es la razon de no usar un documento comun.

Nadie edita el fichero de otro agente, con una excepcion: el agente de integracion, que los lee todos,
aplica lo que proceda, mueve al apartado «Resuelto» del fichero de origen lo que ha aplicado y anota el
resultado en el suyo. Es lo que hizo la ventana de parcheo de W2.5 y lo que hara W7.

## 2. Que se anota

Cuatro categorias, y nada mas:

1. Dependencias que faltan. Paquete, version deseada y por que se necesita. Quien lo pide no ejecuta
   `npm install`.
2. Cambios necesarios en un fichero congelado. Ruta, cambio concreto y motivo. Se aplica en W7, o en la
   fase que corresponda si el fichero todavia esta abierto.
3. Campos, columnas o valores de enumerado que faltan en el contrato. Nombre, tipo, ubicacion en
   `shared/` o en `schema.prisma`, y el uso que lo justifica.
4. Ordenes que hay que ejecutar y que el agente no puede ejecutar: `prisma generate`, `prisma migrate`,
   `npm install`, construcciones de imagenes.

Lo que no se anota aqui: decisiones de arquitectura, que van a `docs/adr.md`; contradicciones del
material de partida, que van a `docs/erratas-gdd-stack.md`; y trabajo pendiente dentro del propio
ambito del agente, que va como comentario en el codigo.

## 3. Forma de la nota

```markdown
# NOTES-W4-C

## Pendiente

### 1. Falta el campo Field.lastWeedSettleGameMs

Categoria: contrato
Ficheros afectados: backend/prisma/schema.prisma, shared/domain/field.ts
Propietario del cambio: W2 (cerrado), a aplicar por W7-A
Motivo: la liquidacion perezosa de malezas necesita su propia marca temporal; con la marca
compartida del registro, liquidar la fertilidad descartaria el tiempo transcurrido de las malezas
(plan seccion 6.5).
Mitigacion adoptada mientras tanto: se usa `lastUpdatedGameMs` y la funcion queda aislada en
`projectWeedLevel`, de modo que el cambio sea de una linea.

## Resuelto

(las notas aplicadas se mueven aqui, con la fase que las aplico)
```

La mitigacion adoptada es obligatoria. Una nota que dice que algo falta, sin decir con que stub se
sigue adelante, deja al agente siguiente sin saber si el codigo esta a medias o completo.

## 4. Estado de las notas

| Fichero | Agente | Estado |
|---|---|---|
| `NOTES-W1.md` | W1 (cimientos) | Abierto: notas 2, 3, 4 y 5 pendientes de W3 y W7 |
| `NOTES-W2a.md` | W2-A (vocabulario) | Cerrado: las cinco notas aplicadas |
| `NOTES-W2b.md` | W2-B (reglas y mundo) | Cerrado: las cinco notas aplicadas |
| `NOTES-W2c.md` | W2-C (contrato de API) | Abierto: notas 1.3, 1.4 y 1.5 pendientes de W3, W4 y W5 |
| `NOTES-w2d.md` | W2-D (esquema de datos) | Cerrado: las diez notas aplicadas |
| `NOTES-w2-cierre.md` | W2-E (cierre documental) | Abierto: queda la actualizacion del apartado 6 del `README.md` de la raiz en cada fase |
| `NOTES-w2-5-parcheo.md` | W2.5 (parcheo e integracion) | Abierto: recoge lo que la ventana dejo por hacer y para quien |
