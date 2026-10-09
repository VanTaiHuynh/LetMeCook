FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O - http://127.0.0.1:8092/_healthz | grep -q "LetMeCook marketing origin ready" || exit 1
CMD ["nginx", "-g", "daemon off;"]
