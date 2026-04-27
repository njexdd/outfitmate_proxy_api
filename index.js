const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- Утилита: retry с экспоненциальным backoff ---
async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const is503 = error?.status === 503 ||
                          error?.message?.includes('503') ||
                          error?.message?.includes('Service Unavailable');

            if (is503 && attempt < maxAttempts) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s...
                console.warn(`[Retry ${attempt}/${maxAttempts}] 503 ошибка. Повтор через ${delay}ms...`);
                await new Promise(res => setTimeout(res, delay));
            } else {
                throw error; // Пробросить, если не 503 или попытки исчерпаны
            }
        }
    }
}

// Эндпоинт для обычных текстовых запросов
app.post('/api/generate', async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Промпт не передан' });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const result = await withRetry(() => model.generateContent(prompt));
        const response = await result.response;
        const text = response.text();

        res.json({ result: text });

    } catch (error) {
        console.error("Ошибка API:", error);

        if (error?.status === 503 || error?.message?.includes('503')) {
            return res.status(503).json({
                error: 'Модель временно перегружена. Попробуйте через несколько секунд.',
                retryable: true
            });
        }

        res.status(500).json({ error: 'Внутренняя ошибка сервера при генерации' });
    }
});

// Эндпоинт для распознавания вещей
app.post('/api/analyze-item', async (req, res) => {
    try {
        const { imageBase64, mimeType = "image/jpeg" } = req.body;

        if (!imageBase64) {
            return res.status(400).json({ error: 'Изображение не передано' });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
        Проанализируй эту одежду по фотографии и верни ответ СТРОГО в формате JSON.
        Ты ДОЛЖЕН использовать СТРОГО те значения, которые указаны в списках ниже. Не придумывай ничего своего.

        Допустимые значения:
        1. name: Короткое и стильное название (например: 'Черное худи', 'Винтажные джинсы', 'Белые кроссовки')
        2. category: Строго одно из ["Верх", "Низ", "Обувь", "Верхняя одежда", "Аксессуары"]
        3. subCategory: В зависимости от выбранной category, выбери строго одно значение:
           - Если "Верх": ["Футболка", "Рубашка", "Свитер", "Худи", "Пиджак", "Топ"]
           - Если "Низ": ["Джинсы", "Брюки", "Шорты", "Юбка", "Спортивки"]
           - Если "Обувь": ["Кроссовки", "Туфли", "Ботинки", "Сапоги", "Сандалии"]
           - Если "Верхняя одежда": ["Куртка", "Пальто", "Тренч", "Пуховик", "Ветровка"]
           - Если "Аксессуары": ["Шапка", "Шарф", "Кепка", "Ремень", "Сумка", "Перчатки"]
        4. style: Строго одно из ["Casual", "Спорт", "Деловой", "Гранж", "Домашний", "Винтаж", "Streetwear", "Минимализм", "Бохо", "Романтичный"]
        5. warmthLevel: Целое число 1, 2 или 3 (1 - летняя/легкая вещь, 2 - демисезон, 3 - теплая зимняя вещь)
        6. colorHex: Верни доминирующий цвет вещи в формате Hex (ARGB), без символа # и 0x. Например, "FF000000" для черного, "FFFFFFFF" для белого, "FFFF0000" для красного и т.д.

        Формат ответа (только JSON без лишнего текста):
        {
          "name": "..."
          "category": "...",
          "subCategory": "...",
          "style": "...",
          "warmthLevel": 1,
          "colorHex": "..."
        }
        `;

        const imagePart = {
            inlineData: { data: imageBase64, mimeType: mimeType }
        };

        const result = await withRetry(() => model.generateContent([prompt, imagePart]));
        const response = await result.response;
        let text = response.text();

        text = text.replace(/```json|```/g, "").trim();

        res.json(JSON.parse(text));

    } catch (error) {
        console.error("Ошибка API анализа изображения:", error);

        if (error?.status === 503 || error?.message?.includes('503')) {
            return res.status(503).json({
                error: 'Модель временно перегружена. Попробуйте через несколько секунд.',
                retryable: true
            });
        }

        res.status(500).json({ error: 'Ошибка сервера при распознавании вещи' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
