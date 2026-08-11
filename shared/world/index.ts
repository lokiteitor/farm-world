// Barrel of the world generator.
//
// Owner: workflow W2 (world). The generator is the reason the world can be virtually
// infinite while only the player modifications are persisted (GDD sections 5, 7 and
// 58): the same seed and the same coordinates rebuild the same terrain on the server
// and on the client, byte for byte.

export * from './terrain.js';
export * from './spawn.js';
