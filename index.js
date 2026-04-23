const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();

app.use(cors());
// ВАЖНО: Увеличиваем лимит размера тела запроса для передачи Base64 изображений (до 10 МБ)
app.use(express.json({ limit: '10mb' }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Твой старый эндпоинт для обычных текстовых запросов (оставляем как есть)
app.post('/api/generate', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Промпт не передан' });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ result: text });
        
    } catch (error) {
        console.error("Ошибка API:", error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера при генерации' });
    }
});

// НОВЫЙ эндпоинт для распознавания вещей
app.post('/api/analyze-item', async (req, res) => {
    try {
        const { imageBase64, mimeType = "image/jpeg" } = req.body;

        if (!imageBase64) {
            return res.status(400).json({ error: 'Изображение не передано' });
        }

        // 1. ИСПОЛЬЗУЕМ gemini-1.5-flash И УБИРАЕМ generationConfig
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash"
        });

        const prompt = `
        Проанализируй эту одежду по фотографии и верни ответ СТРОГО в формате JSON.
        Ты ДОЛЖЕН использовать СТРОГО те значения, которые указаны в списках ниже. Не придумывай ничего своего.

        Допустимые значения:
        1. category: Строго одно из ["Верх", "Низ", "Обувь", "Верхняя одежда", "Аксессуары"]
        2. subCategory: В зависимости от выбранной category, выбери строго одно значение:
           - Если "Верх": ["Футболка", "Рубашка", "Свитер", "Худи", "Пиджак", "Топ"]
           - Если "Низ": ["Джинсы", "Брюки", "Шорты", "Юбка", "Спортивки"]
           - Если "Обувь": ["Кроссовки", "Туфли", "Ботинки", "Сапоги", "Сандалии"]
           - Если "Верхняя одежда": ["Куртка", "Пальто", "Тренч", "Пуховик", "Ветровка"]
           - Если "Аксессуары": ["Шапка", "Шарф", "Кепка", "Ремень", "Сумка", "Перчатки"]
        3. style: Строго одно из ["Casual", "Спорт", "Деловой", "Гранж", "Домашний", "Винтаж", "Streetwear", "Минимализм", "Бохо", "Романтичный"]
        4. warmthLevel: Целое число 1, 2 или 3 (1 - летняя/легкая вещь, 2 - демисезон, 3 - теплая зимняя вещь)
        5. colorHex: Верни доминирующий цвет вещи в формате Hex (ARGB), без символа # и 0x. Например, "FF000000" для черного, "FFFFFFFF" для белого, "FFFF0000" для красного и т.д.

        Формат ответа (только JSON без лишнего текста):
        {
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

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        let text = response.text();

        // 2. ОЧИСТКА ОТ MARKDOWN
        // Gemini может вернуть JSON обернутым в ```json ... ```. Эта строка удаляет обертку.
        text = text.replace(/```json|```/g, "").trim();

        res.json(JSON.parse(text));

    } catch (error) {
        console.error("Ошибка API анализа изображения:", error);
        res.status(500).json({ error: 'Ошибка сервера при распознавании вещи' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
