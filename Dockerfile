FROM node:24

WORKDIR /app

COPY . .

RUN corepack enable && corepack use pnpm@10

RUN pnpm install

EXPOSE 3000

ENV NODE_ENV production

# Use pnpm to start the application
CMD ["pnpm", "start"]
