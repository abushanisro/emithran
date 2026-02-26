# Simplified single-stage build for Railway
FROM node:20-alpine

# Install system dependencies for native modules
RUN apk add --no-cache \
    dumb-init \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    python3 \
    make \
    g++ \
    vips-dev \
    pkgconfig \
    nodejs-npm

# Set working directory
WORKDIR /app

# Install node-gyp globally for native modules
RUN npm install -g node-gyp

# Copy package files
COPY package*.json ./

# Install dependencies with Sharp pre-configuration for Alpine
RUN npm config set sharp_binary_host "https://github.com/lovell/sharp-libvips/releases/download" && \
    npm config set sharp_libvips_binary_host "https://github.com/lovell/sharp-libvips/releases/download" && \
    npm ci --legacy-peer-deps --no-audit --no-fund || \
    (rm -rf node_modules package-lock.json && \
     npm install --legacy-peer-deps --no-audit --no-fund) || \
    (npm install --legacy-peer-deps --no-audit --no-fund --build-from-source)

# Copy source code
COPY . .

# Build application with error handling
RUN npm run build || (echo "Build failed - checking for common issues..." && \
    ls -la dist/ && \
    npm run typecheck && \
    npm run build)

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs && \
    chown -R nestjs:nodejs /app

# Switch to non-root user
USER nestjs

# Expose port (Railway will override with dynamic port)
EXPOSE $PORT

# Set environment
ENV NODE_ENV=production

# Use dumb-init for signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
