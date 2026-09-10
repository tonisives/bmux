FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/client/ /usr/share/nginx/html/
EXPOSE 8080
