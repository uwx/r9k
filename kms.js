import { globSync } from 'node:fs';
process.argv = [
    'node',
    '@atproto/lex-cli',
    'gen-server',
    'src/lexicon',
    ...globSync('lexicons/**/*.json'),
]

import('@atproto/lex-cli');