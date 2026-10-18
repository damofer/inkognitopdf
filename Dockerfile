# Self-hosted InkognitoPDF: builds the static site and serves it with nginx.
#   docker build -t inkognitopdf .
#   docker run -d -p 8080:80 inkognitopdf
# Everything runs in the browser; the container only serves files and relays
# timestamp requests, which carry a hash and never a document (spec 040).

FROM node:24-alpine AS build
# Not /app: the build would mistake the project root for the app/ folder.
WORKDIR /src
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.30-alpine
RUN rm -rf /usr/share/nginx/html/*
# A template: the image's entrypoint fills in the DNS resolvers for /tsa.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
