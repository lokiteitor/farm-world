// Notices.
//
// Owner: W3-C.
//
// A notice is information the player must see that is not the change of an entity: a
// silo that overflowed while nobody was looking, a forced liquidation, a forest that
// matured, a retiming of the world (shared/api/schemas/state.ts). In a game whose
// simulation runs while the player is away, these are the only record of a consequence
// nobody witnessed, so they are kept as a bounded ring and dismissed explicitly rather
// than fading out on a timer.
//
// The ring is bounded because nothing here is authoritative: the ledger and the return
// summary are, and a notice is their announcement. Losing the oldest one after a long
// session costs nothing that a summary does not still explain.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { apiErrorMessage, type NoticeDto, type NoticeKind } from '~/shared/index';

/** Notices kept at once. Beyond this the oldest are dropped. */
export const NOTICE_RING_LIMIT = 100;

/** A notice with the identity the interface needs to dismiss one of several. */
export interface NoticeEntry {
  readonly id: string;
  readonly notice: NoticeDto;
  readonly receivedAtRealMs: number;
  readonly dismissed: boolean;
}

export const useNoticesStore = defineStore('notices', () => {
  const entries = ref<readonly NoticeEntry[]>([]);
  let counter = 0;

  const visible = computed(() => entries.value.filter((entry) => !entry.dismissed));
  const unreadCount = computed(() => visible.value.length);

  const warnings = computed(() =>
    visible.value.filter((entry) => entry.notice.severity === 'WARNING'),
  );

  function ofKind(kind: NoticeKind): readonly NoticeEntry[] {
    return entries.value.filter((entry) => entry.notice.kind === kind);
  }

  /**
   * Text to show. When the notice carries a code, the message comes from the shared
   * table and never from the wire, which is the same rule the errors follow: the wire
   * text exists for the logs and for a client without the table.
   */
  function messageOf(entry: NoticeEntry): string {
    return entry.notice.code === null ? entry.notice.message : apiErrorMessage(entry.notice.code);
  }

  function applyNotice(notice: NoticeDto, receivedAtRealMs: number): void {
    counter += 1;
    const entry: NoticeEntry = {
      id: `notice-${counter}`,
      notice,
      receivedAtRealMs,
      dismissed: false,
    };
    entries.value = [...entries.value, entry].slice(-NOTICE_RING_LIMIT);
  }

  function applyNotices(next: readonly NoticeDto[], receivedAtRealMs: number): void {
    for (const notice of next) {
      applyNotice(notice, receivedAtRealMs);
    }
  }

  function dismiss(id: string): void {
    entries.value = entries.value.map((entry) =>
      entry.id === id ? { ...entry, dismissed: true } : entry,
    );
  }

  function dismissAll(): void {
    entries.value = entries.value.map((entry) => ({ ...entry, dismissed: true }));
  }

  function reset(): void {
    entries.value = [];
    counter = 0;
  }

  return {
    entries,
    visible,
    unreadCount,
    warnings,
    ofKind,
    messageOf,
    applyNotice,
    applyNotices,
    dismiss,
    dismissAll,
    reset,
  };
});
