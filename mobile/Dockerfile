# Mobile dev environment — Expo SDK 54 Metro bundler
FROM node:22-alpine

WORKDIR /app

# Copy package.json first for layer caching
COPY package.json ./

# Clean install inside the image layer
RUN npm install --legacy-peer-deps 2>&1

# Copy app source
COPY . .

EXPOSE 8081

# Metro bundler — ensure node_modules volume is always synchronized with package.json before starting Expo
CMD ["sh", "-c", "npm install --legacy-peer-deps && npx expo start -c --lan"]
