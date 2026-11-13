FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ARG FASTAPI_ORIGIN=http://backend:8000
ENV FASTAPI_ORIGIN=${FASTAPI_ORIGIN}
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
