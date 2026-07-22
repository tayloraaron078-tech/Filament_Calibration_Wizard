# --- Build stage ---
FROM node:24-slim AS build
WORKDIR /app

# Install deps first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source and build the static bundle
COPY . .
RUN npm run build   # typechecks, then bundles to dist/

# --- Runtime stage ---
FROM busybox:latest AS runtime
WORKDIR /www

# dist/ is fully static with relative paths per the project's README
COPY --from=build /app/dist /www

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ || exit 1

CMD ["busybox", "httpd", "-f", "-v", "-p", "80"]