import { Kysely, Migration, MigrationProvider } from 'kysely'

const migrations: Record<string, Migration> = {}

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations
  },
}

migrations['001'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('post')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('cid', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createTable('sub_state')
      .addColumn('service', 'varchar', (col) => col.primaryKey())
      .addColumn('cursor', 'integer', (col) => col.notNull())
      .execute()
    await db.schema
      .createTable('config')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('value', 'blob', (col) => col.notNull())
      .execute()
    await db.schema
      .createIndex('post_indexedAt_cid_idx')
      .on('post')
      .columns(['indexedAt', 'cid'])
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropIndex('post_indexedAt_cid_idx').execute()
    await db.schema.dropTable('post').execute()
    await db.schema.dropTable('sub_state').execute()
    await db.schema.dropTable('config').execute()
  },
}

// post no longer needed since we are using an in-memory ring buffer instead of the database for storing them
migrations['002'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .dropTable('post')
      .ifExists()
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .createTable('post')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('cid', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createIndex('post_indexedAt_cid_idx')
      .on('post')
      .columns(['indexedAt', 'cid'])
      .execute()
  },
}