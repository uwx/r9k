import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { ringBuffer } from '../r9k/ringbuffer'
import { RingBuffer } from 'ring-buffer-ts'

export const shortname = 'r9k'

function* iter<T>(buffer: RingBuffer<T>) {
  for (let i = 0; i < buffer.getSize(); i++) {
    const v = buffer.get(i);
    if (v === undefined) {
      break;
    }
    yield v;
  }
}

// Iter by newest to oldest
function* reverseIter<T>(buffer: RingBuffer<T>) {
  for (let i = buffer.getSize() - 1; i >= 0; i--) {
    const v = buffer.get(i);
    if (v !== undefined) {
      yield v;
    }
  }
}

export const handler = async (ctx: AppContext, params: QueryParams) => {
  let iterator: IteratorObject<{ uri: string, cid: string, indexedAt: Date }> = reverseIter(ringBuffer);
  if (params.cursor) {
    const timeStr = new Date(parseInt(params.cursor, 10))
    iterator = iterator.filter((v) => v.indexedAt < timeStr)
  }

  iterator = iterator.take(params.limit);

  const res = iterator.toArray();

  const feed = res.map((row) => ({
    post: row.uri,
  }));

  let cursor: string | undefined
  const last = res.at(-1)
  if (last) {
    cursor = last.indexedAt.getTime().toString(10)
  }

  return {
    cursor,
    feed,
  }
}
