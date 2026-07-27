# Capote Voice backend — production image
FROM node:20-alpine

WORKDIR /app

# Install only production deps first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source
COPY src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Do NOT bake secrets into the image — pass them as env vars at runtime.
CMD ["node", "src/index.js"]
