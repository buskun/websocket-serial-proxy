FROM node:22-slim as builder

WORKDIR /usr/src/websocket-serial-proxy

COPY . .

RUN npm install -g pnpm

RUN pnpm install --frozen-lockfile
RUN pnpm run build

RUN apt-get update && apt-get install -y udev

ENV WS_PORT=8080
ENV BAUD_RATE=115200

EXPOSE 8080

CMD ["npm", "start"]
