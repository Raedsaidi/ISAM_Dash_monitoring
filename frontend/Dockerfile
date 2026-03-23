# Étape 1 : build du frontend avec Node
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./

# Install inside Docker (never copy node_modules from host)
RUN npm install && chmod +x node_modules/.bin/vite

COPY . .

RUN npm run build

# Étape 2 : servir les fichiers statiques avec Nginx
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# Uncomment and add nginx.conf to fix React Router 404s
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]