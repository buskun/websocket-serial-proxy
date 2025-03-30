FROM node:22-slim as builder

WORKDIR /usr/src/websocket-serial-proxy

COPY . .

RUN npm install -g pnpm

RUN pnpm install --frozen-lockfile
RUN pnpm run build

ENV WS_PORT=8080
ENV BAUD_RATE=115200

EXPOSE $WS_PORT

CMD ["node", "dist/server"]
