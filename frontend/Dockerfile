# Stage 0, "build-stage", based on Node.js, to build and compile the frontend
FROM node:25 AS build-stage

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /app/
COPY tsconfig.json /app/tsconfig.json
COPY frontend/package.json /app/frontend/package.json
COPY shared/package.json /app/shared/package.json

RUN corepack enable && pnpm install --filter frontend... --no-frozen-lockfile --prod=false

COPY frontend /app/frontend
COPY shared /app/shared

ARG VITE_API_URL=${VITE_API_URL}

WORKDIR /app/frontend

RUN pnpm run build


# Stage 1, based on Nginx, to have only the compiled app, ready for production with Nginx
FROM nginx:1

COPY --from=build-stage /app/frontend/dist/ /usr/share/nginx/html

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/nginx-backend-not-found.conf /etc/nginx/extra-conf.d/backend-not-found.conf
