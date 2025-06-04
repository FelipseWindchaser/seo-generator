FROM node:20-alpine as builder

WORKDIR /app

# Копируем package файлы
COPY package*.json ./
RUN npm ci

# Копируем исходный код
COPY . .

# Собираем приложение
RUN npm run build

# Финальный образ
FROM node:20-alpine

WORKDIR /app

# Копируем собранное приложение
COPY --from=builder /app/.output .output
COPY --from=builder /app/package*.json ./

# Устанавливаем только production зависимости
RUN npm ci --production

EXPOSE 3000

ENV HOST=0.0.0.0
ENV PORT=3000

CMD ["node", ".output/server/index.mjs"]
