import { ScalableBloomFilter } from 'bloom-filters'
import { Database } from './db'
import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import * as AppBskyEmbedRecordWithMedia from './lexicon/types/app/bsky/embed/recordWithMedia'
import * as AppBskyEmbedImages from './lexicon/types/app/bsky/embed/images'
import * as AppBskyFeedPost from './lexicon/types/app/bsky/feed/post'
import { bloomFilter, saveBloomFilter } from './r9k/bloom'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'

import { DidResolver } from '@atproto/identity'
import { clampLuminosity, ClampValue, generateSignature } from './r9k/puzzle'
import sharp from 'sharp'

const didResolver = new DidResolver({})

async function getBlobAsBuffer(did: string, cid: string) {
  // inside the loop:
  const didDoc = await didResolver.resolve(did)
  const pds = didDoc?.service?.find(s => s.id === '#atproto_pds')?.serviceEndpoint as string

  const res = await fetch(
    `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`
  )
  return await res.arrayBuffer();
}

async function checkRecord(
  bloomFilter: ScalableBloomFilter,
  author: string,
  uri: string,
  record: AppBskyFeedPost.Record,
  depth = 0,
) {
  if (depth > 5) {
    return false;
  }

  const textLower = record.text.toLowerCase();
  if (bloomFilter.has(textLower)) {
    return false;
  }
  bloomFilter.add(textLower);

  if (record.embed && (record.embed.$type == 'app.bsky.embed.recordWithMedia' || record.embed.$type == 'app.bsky.embed.recordWithMedia#main')) {
    const embed = record.embed as AppBskyEmbedRecordWithMedia.Main;
    if (embed.media.$type == 'app.bsky.embed.images') {
      const images = embed.media as AppBskyEmbedImages.Main;
      for (const image of images.images) {
        const cid = image.image.ref.toString();
        console.log(cid);
        if (bloomFilter.has(cid)) {
          return false;
        }
        bloomFilter.add(cid);

        try {
          const buffer = await getBlobAsBuffer(author, cid);
          const sig = await generateSignature(sharp(buffer).resize(128, 128), {
            debug_makeGrayscale: true
          });
          if (bloomFilter.has(sig.buffer)) {
            return false;
          }
          bloomFilter.add(sig.buffer);
        } catch (err) {
          console.error(`Failed to process image ${cid} for post ${uri}:`, err);
          return false;
        }
      }
    }
  } else if (record.embed && (record.embed.$type == 'app.bsky.embed.images' || record.embed.$type == 'app.bsky.embed.images#main')) {
    const images = record.embed as AppBskyEmbedImages.Main;
    for (const image of images.images) {
      const cid = image.image.ref.toString();
      console.log(cid);
      if (bloomFilter.has(cid)) {
        return false;
      }
      bloomFilter.add(cid);

      try {
        const buffer = await getBlobAsBuffer(author, cid);
        const sig = await generateSignature(sharp(buffer).resize(128, 128), {
          debug_makeGrayscale: true
        });
        if (bloomFilter.has(sig.buffer)) {
          return false;
        }
        bloomFilter.add(sig.buffer);
      } catch (err) {
        console.error(`Failed to process image ${cid} for post ${uri}:`, err);
        return false;
      }
    }
  } // todo process record embed in record

  return true;
}

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  bloomFilter: Promise<ScalableBloomFilter>
  i = 0

  constructor(db: Database, service: string) {
    super(db, service)
    this.bloomFilter = bloomFilter(db)
  }

  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    const bloomFilter = await this.bloomFilter

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)

    const postsToCreate: Array<{ uri: string, cid: string, indexedAt: string }> = [];
    for (const create of ops.posts.creates) {
      if (!await checkRecord(bloomFilter, create.author, create.uri, create.record)) {
        continue;
      }

      postsToCreate.push({
        uri: create.uri,
        cid: create.cid,
        indexedAt: new Date().toISOString(),
      });
    }

    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }
    if (postsToCreate.length > 0) {
      await this.db
        .insertInto('post')
        .values(postsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }

    if (this.i++ % 100 == 0) {
      await saveBloomFilter(this.db, bloomFilter);
    }
  }
}
