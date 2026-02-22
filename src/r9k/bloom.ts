import { ScalableBloomFilter } from 'bloom-filters'
import { Database } from '../db'
import { decode, encode } from 'msgpackr';

export const bloomFilter = async (db: Database) => {
  const existing = await db.selectFrom('config')
    .select('value')
    .where('key', '=', 'bloom-filter')
    .executeTakeFirst();

  if (existing) {
    const filter = ScalableBloomFilter.fromJSON(decode(existing.value));
    return filter;
  } else {
    return new ScalableBloomFilter(10_000, 0.005, 0.7)
  }
}

export const saveBloomFilter = async (db: Database, filter: ScalableBloomFilter) => {
  const encoded = encode(filter.saveAsJSON());
  await db.insertInto('config')
    .values({
      key: 'bloom-filter',
      value: encoded
    })
    .onConflict((oc) => oc
      .column('key')
      .doUpdateSet({ value: encoded }))
    .execute();
}