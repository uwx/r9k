import { RingBuffer } from "ring-buffer-ts";

export const ringBuffer = new RingBuffer<{ uri: string, cid: string, indexedAt: Date }>(10_000);