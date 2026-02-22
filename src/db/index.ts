import { Kysely, Migrator, SqliteDialect } from 'kysely'
import { DatabaseSchema } from './schema'
import { migrationProvider } from './migrations'

import { DatabaseSync } from 'node:sqlite'
import { buildQueryFn, GenericSqliteDialect, parseBigInt } from 'kysely-generic-sqlite'
import type { IGenericSqlite } from 'kysely-generic-sqlite'

function createSqliteExecutor(db: DatabaseSync): IGenericSqlite<DatabaseSync> {
  const getStmt = (sql: string) => {
    const stmt = db.prepare(sql)
    stmt.setReadBigInts(true)
    return stmt
  }

  return {
    db,
    query: buildQueryFn({
      all: (sql, parameters = []) => getStmt(sql).all(...parameters),
      run: (sql, parameters = []) => {
        const { changes, lastInsertRowid } = getStmt(sql).run(...parameters)
        return {
          insertId: parseBigInt(lastInsertRowid),
          numAffectedRows: parseBigInt(changes),
        }
      },
    }),
    close: () => db.close(),
    iterator: (isSelect, sql, parameters = []) => {
      if (!isSelect) {
        throw new Error('Only support select in stream()')
      }
      return getStmt(sql).iterate(...parameters) as any
    },
  }
}

export const createDb = (location: string): Database => {
  return new Kysely<DatabaseSchema>({
    dialect: new GenericSqliteDialect(
      () => createSqliteExecutor(new DatabaseSync(location)),
    ),
  })
}

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

export type Database = Kysely<DatabaseSchema>
