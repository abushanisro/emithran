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
    pkgconfig

# Set working directory
WORKDIR /app

# Install node-gyp globally for native modules
RUN npm install -g node-gyp

# Copy package files
COPY package*.json ./

# Set environment variables to use pre-built Sharp binaries
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1 \
    npm_config_sharp_binary_host="https://github.com/lovell/sharp-libvips/releases/download" \
    npm_config_sharp_libvips_binary_host="https://github.com/lovell/sharp-libvips/releases/download"

# First try to install without Sharp to identify if it's the only issue
RUN npm ci --legacy-peer-deps --no-audit --no-fund --ignore-scripts || \
    (rm -rf node_modules package-lock.json && \
     npm install --legacy-peer-deps --no-audit --no-fund --ignore-scripts)

# Then install Sharp specifically with Alpine-compatible version
RUN npm install sharp@^0.33.0 --legacy-peer-deps --no-audit --platform=linux --arch=x64 || \
    npm install --save-optional sharp@^0.32.0 --legacy-peer-deps --no-audit || \
    echo "Sharp installation failed - application may work without image processing"

# Run scripts for all packages except Sharp
RUN npm rebuild --legacy-peer-deps || echo "Some packages failed to rebuild"

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
