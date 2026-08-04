FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
# Baked into the JS bundle at build time. Leave empty (default) to have the
# frontend detect the API host at runtime from the page's own address —
# only set this if the API is reachable at a different host/port than
# "same host as the page, port 3000" (e.g. a reverse proxy with a domain).
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
