FROM node:20

WORKDIR /app

COPY . .

RUN pnpm install

EXPOSE 3000

ENV NODE_ENV production

# Use pnpm to start the application
CMD ["pnpm", "start"]
