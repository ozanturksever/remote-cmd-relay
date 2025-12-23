FROM oven/bun:1-debian

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN bun install --production

# Copy source files
COPY . .

# Set entrypoint - expects API_KEY and CONVEX_URL as arguments
ENTRYPOINT ["bun", "run", "index.ts"]
