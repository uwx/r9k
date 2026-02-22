import http from 'http'
import events from 'events'
import express from 'express'
import { DidResolver, MemoryCache } from '@atproto/identity'
import { createServer } from './lexicon/index.js'
import feedGeneration from './methods/feed-generation.js'
import describeGenerator from './methods/describe-generator.js'
import { createDb, type Database, migrateToLatest } from './db/index.js'
import type { AppContext, Config } from './config.js'
import wellKnown from './well-known.js'
import { Worker } from 'worker_threads'
import { ringBuffer } from './r9k/ringbuffer.js'

export class FeedGenerator {
  public app: express.Application
  public server?: http.Server
  public db: Database
  public cfg: Config
  public worker: Worker

  constructor(
    app: express.Application,
    db: Database,
    cfg: Config,
  ) {
    this.app = app
    this.db = db
    this.cfg = cfg
    this.worker = new Worker('./out/worker.js', { workerData: { cfg } })
    this.worker.postMessage({ type: 'init' })
    this.worker.on('message', (msg) => {
      if (msg.type === 'addPosts') {
        ringBuffer.add(...msg.posts)
      }
    })
  }

  static create(cfg: Config) {
    const app = express()
    const db = createDb(cfg.sqliteLocation)

    const didCache = new MemoryCache()
    const didResolver = new DidResolver({
      plcUrl: 'https://plc.directory',
      didCache,
    })

    const server = createServer({
      validateResponse: true,
      payload: {
        jsonLimit: 100 * 1024, // 100kb
        textLimit: 100 * 1024, // 100kb
        blobLimit: 5 * 1024 * 1024, // 5mb
      },
    })
    const ctx: AppContext = {
      db,
      didResolver,
      cfg,
    }
    feedGeneration(server, ctx)
    describeGenerator(server, ctx)
    app.use(server.xrpc.router)
    app.use(wellKnown(ctx))

    return new FeedGenerator(app, db, cfg)
  }

  async start(): Promise<http.Server> {
    await migrateToLatest(this.db)
    this.server = this.app.listen(this.cfg.port, this.cfg.listenhost)
    this.worker.postMessage({ type: 'run' })
    await events.once(this.server, 'listening')
    return this.server
  }
}

export default FeedGenerator
