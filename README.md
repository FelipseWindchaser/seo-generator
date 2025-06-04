# SEO Generator для Wildberries

Автоматизированная система генерации SEO-описаний для товаров на Wildberries с использованием AI.

## Технологии

- **Frontend**: Vue 3 + Nuxt 3 + TypeScript
- **Backend**: Nitro (встроенный в Nuxt)
- **AI**: Anthropic Claude 3.5 Sonnet
- **База данных**: Redis
- **Контейнеризация**: Docker + Docker Compose

## Особенности

- ✅ Полная типизация TypeScript
- ✅ Асинхронная обработка с очередями
- ✅ Умная валидация с морфологическим анализом
- ✅ Автоматические повторные попытки
- ✅ Мониторинг и аналитика
- ✅ Готов к продакшену

## Установка

1. Клонируйте репозиторий
2. Скопируйте `.env.example` в `.env` и заполните ключи API
3. Запустите через Docker Compose:

```bash
docker-compose up -d
```
