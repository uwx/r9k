import type { AppContext } from '../config.js'
import type {
  QueryParams,
  OutputSchema as AlgoOutput
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton.js'
import * as r9k from './r9k.js'

type AlgoHandler = (ctx: AppContext, params: QueryParams) => Promise<AlgoOutput>

const algos: Record<string, AlgoHandler> = {
  [r9k.shortname]: r9k.handler,
}

export default algos
