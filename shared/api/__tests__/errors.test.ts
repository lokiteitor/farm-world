// The error surface: codes, messages, statuses and constructors.
//
// Owner: workflow W2 (API contract).

import { describe, expect, it } from 'vitest';
import { VALIDATION_CODES, VALIDATION_MESSAGES, ValidationCode } from '../../domain/enums.js';
import {
  API_ERROR_CODES,
  API_ERROR_HTTP_STATUS,
  API_ERROR_MESSAGES,
  API_ERROR_STATUS,
  API_TRANSPORT_CODES,
  ApiError,
  ApiTransportCode,
  apiErrorMessage,
  apiErrorReply,
  capacityExceeded,
  contractVersionMismatch,
  httpStatusForApiErrorCode,
  insufficientFunds,
  isApiError,
  isApiErrorReply,
  notFound,
  notOwned,
  selectionTooLarge,
} from '../errors.js';

const KNOWN_STATUSES = new Set<number>(Object.values(API_ERROR_STATUS));

describe('codes and messages', () => {
  it('covers every validation code of the domain and adds only the transport ones', () => {
    for (const code of VALIDATION_CODES) {
      expect(API_ERROR_CODES).toContain(code);
    }
    expect(API_ERROR_CODES.length).toBe(VALIDATION_CODES.length + API_TRANSPORT_CODES.length);
  });

  it('never lets a transport code collide with a validation code', () => {
    for (const code of API_TRANSPORT_CODES) {
      expect(VALIDATION_CODES).not.toContain(code);
    }
  });

  it('gives every code a non empty message, taking the domain ones unchanged', () => {
    for (const code of API_ERROR_CODES) {
      expect(apiErrorMessage(code).length, code).toBeGreaterThan(0);
    }
    for (const code of VALIDATION_CODES) {
      expect(API_ERROR_MESSAGES[code]).toBe(VALIDATION_MESSAGES[code]);
    }
  });

  it('never interpolates a figure into a message', () => {
    // The figures travel in `details`, so a message carries no placeholder and no digit
    // that would have to be substituted (plan section 8).
    for (const code of API_ERROR_CODES) {
      expect(apiErrorMessage(code)).not.toMatch(/[{$%]|\bXX?\b/);
    }
  });
});

describe('http statuses', () => {
  it('assigns a known status to every code', () => {
    for (const code of API_ERROR_CODES) {
      const status = httpStatusForApiErrorCode(code);
      expect(KNOWN_STATUSES.has(status), `${code} -> ${status}`).toBe(true);
    }
  });

  it('maps the two money codes to payment required and nothing else to it', () => {
    const paymentRequired = API_ERROR_CODES.filter(
      (code) => API_ERROR_HTTP_STATUS[code] === API_ERROR_STATUS.PAYMENT_REQUIRED,
    );
    expect([...paymentRequired].sort()).toEqual(
      [ValidationCode.INSUFFICIENT_FUNDS, ValidationCode.SPENDING_BLOCKED_IN_DEBT].sort(),
    );
  });

  it('maps every authentication failure to unauthorised', () => {
    // The five authentication codes are members of `ValidationCode` since the W2.5
    // patching window; `ApiTransportCode` keeps only the six failures of the service.
    for (const code of [
      ValidationCode.AUTH_REQUIRED,
      ValidationCode.AUTH_INVALID_CREDENTIALS,
      ValidationCode.AUTH_TOKEN_EXPIRED,
      ValidationCode.AUTH_TICKET_INVALID,
    ]) {
      expect(API_ERROR_HTTP_STATUS[code]).toBe(API_ERROR_STATUS.UNAUTHORIZED);
    }
  });

  it('maps the capacity and reservation rules to conflict', () => {
    for (const code of [
      ValidationCode.GARAGE_CAPACITY_EXCEEDED,
      ValidationCode.HOME_CAPACITY_EXCEEDED,
      ValidationCode.STORAGE_CAPACITY_EXCEEDED,
      ValidationCode.MACHINE_NOT_IDLE,
      ValidationCode.WORKER_NOT_IDLE,
      ValidationCode.FIELD_STATE_NOT_ALLOWED,
      ValidationCode.CELL_ALREADY_OWNED,
    ]) {
      expect(API_ERROR_HTTP_STATUS[code], code).toBe(API_ERROR_STATUS.CONFLICT);
    }
  });

  it('maps the malformed selection rules to bad request', () => {
    for (const code of [
      ValidationCode.SELECTION_EMPTY,
      ValidationCode.SELECTION_TOO_LARGE,
      ValidationCode.SELECTION_NOT_CONTIGUOUS,
      ValidationCode.SELECTION_NOT_ADJACENT,
      ValidationCode.VALIDATION_FAILED,
    ]) {
      expect(API_ERROR_HTTP_STATUS[code], code).toBe(API_ERROR_STATUS.BAD_REQUEST);
    }
  });

  it('maps a missing resource to not found and a resource of another player to forbidden', () => {
    expect(API_ERROR_HTTP_STATUS[ValidationCode.NOT_FOUND]).toBe(API_ERROR_STATUS.NOT_FOUND);
    expect(API_ERROR_HTTP_STATUS[ValidationCode.NOT_OWNED]).toBe(API_ERROR_STATUS.FORBIDDEN);
  });
});

describe('constructors', () => {
  it('derives the status and the message from the code', () => {
    const error = new ApiError(ValidationCode.INSUFFICIENT_FUNDS);
    expect(error.status).toBe(API_ERROR_STATUS.PAYMENT_REQUIRED);
    expect(error.message).toBe(VALIDATION_MESSAGES.INSUFFICIENT_FUNDS);
    expect(isApiError(error)).toBe(true);
    expect(isApiError(new Error('otro'))).toBe(false);
  });

  it('builds a reply body that validates against the schema', () => {
    expect(isApiErrorReply(new ApiError(ValidationCode.NOT_FOUND).toReply())).toBe(true);
    expect(isApiErrorReply(apiErrorReply(ApiTransportCode.RATE_LIMITED))).toBe(true);
    expect(isApiErrorReply({ error: { code: 'NOT_FOUND' } })).toBe(false);
    expect(isApiErrorReply({ code: 'NOT_FOUND', message: 'x' })).toBe(false);
  });

  it('carries the figures of each rule in the details', () => {
    expect(notFound('FIELD', 'fld_1').details).toEqual({ entityKind: 'FIELD', entityId: 'fld_1' });
    expect(notOwned('MACHINE', 'mch_1').status).toBe(API_ERROR_STATUS.FORBIDDEN);
    expect(insufficientFunds('18000.0000', '1200.0000').details).toEqual({
      requiredMoney: '18000.0000',
      availableMoney: '1200.0000',
    });
    expect(selectionTooLarge(2001, 2000).details).toEqual({ cellCount: 2001, limit: 2000 });
    expect(
      capacityExceeded(ValidationCode.GARAGE_CAPACITY_EXCEEDED, 4, 4, 'bld_1').details,
    ).toEqual({ occupancy: 4, capacity: 4, entityId: 'bld_1' });
    expect(contractVersionMismatch('0.1.0', '0.0.9').details).toEqual({
      expected: '0.1.0',
      actual: '0.0.9',
    });
  });

  it('omits the details entirely when there are none', () => {
    const body = new ApiError(ValidationCode.WORLD_PAUSED).toReply();
    expect('details' in body.error).toBe(false);
  });
});
