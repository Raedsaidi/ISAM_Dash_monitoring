# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Declare build args
ARG VITE_AUTH_BASE_URL
ARG VITE_ISAM_BASE_URL
ARG VITE_CISCO_BASE_URL
# Make them available to Vite during build
ENV VITE_AUTH_BASE_URL=$VITE_AUTH_BASE_URL
ENV VITE_ISAM_BASE_URL=$VITE_ISAM_BASE_URL
ENV VITE_CISCO_BASE_URL=$VITE_CISCO_BASE_URL

COPY package*.json ./
RUN npm install && chmod +x node_modules/.bin/vite

COPY . .
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]