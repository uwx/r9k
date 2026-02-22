import { defineConfig } from 'rolldown';

export default defineConfig({
    input: {
        index: 'src/index.ts',
        worker: 'src/r9k/worker.ts',
    },
    platform: 'node',
    external: [
        'node:*', 'sharp', 'kysely'
    ],
    output: {
        dir: 'out',
        sourcemap: 'inline'
    },
});