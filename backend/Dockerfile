# Simplified single-stage build for Railway
FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache dumb-init

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build application
RUN npm run build

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs && \
    chown -R nestjs:nodejs /app

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 4000

# Set environment
ENV NODE_ENV=production

# Use dumb-init for signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
