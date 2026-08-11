// Barrel of the WebSocket contract.
//
// Owner: workflow W2 (API contract).
//
// `events` declares the payload of every tag and the union of `{ type, payload }` pairs;
// `envelope` wraps them with the sequence and the game instant, and declares what the
// client may send upwards. Both depend on shared/api/schemas, because the entities that
// travel in a frame are the same read models the REST replies carry: an event that
// described an entity differently from the endpoint that returns it would be a second
// vocabulary for the same fact.

export * from './events.js';
export * from './envelope.js';
