// The error handler: one body shape, no stack traces, no invented status codes.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Every failure of the API leaves through here and leaves with the same body,
// `{ error: { code, message, details? } }`, whatever its origin. The status comes from
// `API_ERROR_HTTP_STATUS` and never from the throw site, so a handler cannot pick a status
// that contradicts the table, and the client branches on `code` and never on the status
// (shared/api/errors.ts).
//
// What must never reach the client: a stack trace, the text of a PostgreSQL error, the name
// of a constraint, a Prisma message. All of them are logged in full and none of them
// travels. That is not only hygiene: a constraint name is a map of the schema, and a Prisma
// message can carry the value that was being written.
//
// The five families, in the order they are tested:
//
//   1. `ApiError`, which is the normal way a domain rule refuses. It already carries its
//      code, its status and its details.
//   2. A schema validation failure from Zod, which becomes `VALIDATION_FAILED` with the
//      dotted path of the first offending field in `details.field`.
//   3. A reply that did not match its own schema, which is a bug in a handler, not in the
//      request: it is logged loudly and reported as an internal error.
//   4. The errors of the infrastructure this workflow owns: a player that vanished, a world
//      that is not seeded, a rate limit, a connection that is down.
//   5. Anything else: `INTERNAL_ERROR` with the identifier of the request, which is the
//      only thing the client is told and the thing that makes the log line findable.

import {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { Prisma } from '../generated/prisma/client.js';
import { PlayerNotFoundError } from '../lib/advancePlayer.js';
import { WorldConstantsMismatchError, WorldNotSeededError } from '../lib/gameClock.js';
import {
  ApiTransportCode,
  ValidationCode,
  apiErrorReply,
  httpStatusForApiErrorCode,
  isApiError,
  type ApiErrorCode,
  type ApiErrorDetails,
  type ApiErrorReply,
} from '../shared/index.js';

/** A code with its details, before it becomes a reply. */
interface Mapped {
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetails;
  /** True when the cause deserves an `error` line and not a `warn` line. */
  readonly severe: boolean;
}

/** The dotted path of the first offending field of a Zod failure. */
function firstInvalidField(error: unknown): string | undefined {
  if (!hasZodFastifySchemaValidationErrors(error)) {
    return undefined;
  }
  const first = error.validation[0];
  if (first === undefined) {
    return undefined;
  }
  // `instancePath` is a JSON pointer, `/body/cells/0/cellX`. The dotted form is what the
  // panels of the client expect in `details.field`.
  const path = first.instancePath.replace(/^\//, '').split('/').filter(Boolean).join('.');
  return path.length === 0 ? first.keyword : path;
}

/** Maps a thrown value to a code. */
function mapError(error: unknown): Mapped {
  if (isApiError(error)) {
    return error.details === undefined
      ? { code: error.code, severe: false }
      : { code: error.code, details: error.details, severe: false };
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    const field = firstInvalidField(error);
    return {
      code: ValidationCode.VALIDATION_FAILED,
      severe: false,
      ...(field === undefined ? {} : { details: { field } }),
    };
  }

  if (isResponseSerializationError(error)) {
    // The handler built a reply its own schema refuses. The client gets nothing about it,
    // because it is not the client's fault and the detail would describe our internals.
    return { code: ApiTransportCode.INTERNAL_ERROR, severe: true };
  }

  if (error instanceof PlayerNotFoundError) {
    return { code: ValidationCode.NOT_FOUND, details: { entityKind: 'player' }, severe: false };
  }

  if (error instanceof WorldNotSeededError || error instanceof WorldConstantsMismatchError) {
    return { code: ApiTransportCode.SERVICE_UNAVAILABLE, severe: true };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2025':
        // "An operation failed because it depends on one or more records that were
        // required but not found."
        return { code: ValidationCode.NOT_FOUND, severe: false };
      case 'P1001':
      case 'P1002':
      case 'P1017':
        return { code: ApiTransportCode.SERVICE_UNAVAILABLE, severe: true };
      default:
        // A unique violation or a check violation that reached this far is a rule the
        // module should have expressed itself. It is severe on purpose: the fix is a
        // conditional update in the module, not a mapping here.
        return { code: ApiTransportCode.INTERNAL_ERROR, severe: true };
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return { code: ApiTransportCode.SERVICE_UNAVAILABLE, severe: true };
  }

  const fastifyError = error as FastifyError | undefined;
  if (fastifyError?.statusCode === 429) {
    return { code: ApiTransportCode.RATE_LIMITED, severe: false };
  }
  if (fastifyError?.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || fastifyError?.statusCode === 400) {
    return { code: ValidationCode.VALIDATION_FAILED, severe: false };
  }

  return { code: ApiTransportCode.INTERNAL_ERROR, severe: true };
}

/** The reply body of a mapped error, with the request identifier when it is internal. */
function replyBodyOf(mapped: Mapped, requestId: string): ApiErrorReply {
  if (mapped.code === ApiTransportCode.INTERNAL_ERROR) {
    return apiErrorReply(mapped.code, { ...mapped.details, entityId: requestId });
  }
  return mapped.details === undefined
    ? apiErrorReply(mapped.code)
    : apiErrorReply(mapped.code, mapped.details);
}

/** Installs the error handler and the not found handler on the root instance. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const mapped = mapError(error);
    const status = httpStatusForApiErrorCode(mapped.code);
    const line = {
      err: error,
      code: mapped.code,
      status,
      method: request.method,
      url: request.url,
      requestId: request.id,
    };
    if (mapped.severe) {
      request.log.error(line, 'request failed');
    } else {
      request.log.warn(line, 'request refused');
    }
    return reply.status(status).send(replyBodyOf(mapped, String(request.id)));
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    // A route that does not exist is `NOT_FOUND` with the same body as everything else, so
    // a client that mistypes a path gets a readable answer instead of the default HTML-ish
    // payload of the framework.
    return reply
      .status(httpStatusForApiErrorCode(ValidationCode.NOT_FOUND))
      .send(apiErrorReply(ValidationCode.NOT_FOUND, { field: `${request.method} ${request.url}` }));
  });
}
