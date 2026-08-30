# Frontend — Next.js 14 with all deps installed at build time
FROM node:20-alpine

WORKDIR /app

# Install deps first (layer caching)
COPY package.json package-lock.json* ./
RUN npm install

# Copy app source
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]