const express = require('express');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000; // Использование порта из переменной окружения Railway

// Middleware для Railway
app.use(cors({
    origin: '*',  // Заменить на URL вашего фронтенда для повышения безопасности
    credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==================== ПРОСТАЯ БАЗА ДАННЫХ В ПАМЯТИ ====================
let users = [];
let telegramCodes = [];
let nextUserId = 1;

// Функция отправки сообщения в Telegram
async function sendTelegramMessage(chatId, message) {
    try {
        const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;  // Чтение токена из переменной окружения

        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            })
        });
        
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('❌ Ошибка отправки Telegram сообщения:', error);
        throw error;
    }
}

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Сервер работает на Railway!',
        timestamp: new Date().toISOString(),
        users_count: users.length
    });
});

// Регистрация пользователя
app.post('/api/auth/register', (req, res) => {
    try {
        const { full_name, email, password } = req.body;
        
        if (!full_name || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Все поля обязательны для заполнения'
            });
        }
        
        // Проверяем существует ли пользователь
        const existingUser = users.find(u => u.email === email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        // Создаем пользователя
        const user = {
            id: nextUserId++,
            name: full_name,
            email: email,
            password: password,
            telegram_chat_id: null,
            created_at: new Date().toISOString()
        };
        
        users.push(user);
        
        console.log('✅ Пользователь зарегистрирован:', email);
        
        res.json({
            success: true,
            message: 'Регистрация успешна! Теперь привяжите Telegram.',
            user_id: user.id
        });
        
    } catch (error) {
        console.error('❌ Ошибка регистрации:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// Вход
app.post('/api/auth/login', (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = users.find(u => u.email === email && u.password === password);
        if (user) {
            const { password, ...userWithoutPassword } = user;
            res.json({ 
                success: true, 
                message: 'Вход выполнен!',
                user: userWithoutPassword
            });
        } else {
            res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// Запрос кода для привязки Telegram
app.post('/api/auth/request-telegram-link', (req, res) => {
    try {
        const { email } = req.body;
        
        const user = users.find(u => u.email === email);
        if (!user) {
            return res.status(400).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const linkCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        res.json({ 
            success: true, 
            linkCode: linkCode,
            instructions: `Отправьте боту команду: /link ${linkCode}`
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// Подтверждение привязки Telegram
app.post('/api/auth/confirm-telegram-link', (req, res) => {
    try {
        const { linkCode, telegram_chat_id } = req.body;
        
        const user = users.find(u => u.telegram_chat_id === null);  // Находим первого пользователя без Telegram
        
        if (user) {
            user.telegram_chat_id = telegram_chat_id;
            
            // Отправляем приветственное сообщение в Telegram
            sendTelegramMessage(telegram_chat_id,
                `✅ Telegram успешно привязан!\n\n` +
                `📧 Аккаунт: ${user.email}\n` +
                `👤 Имя: ${user.name}\n\n` +
                `Теперь вы можете восстанавливать пароль!`
            ).catch(err => {
                console.error('Ошибка отправки сообщения:', err);
            });
            
            res.json({ 
                success: true, 
                message: 'Telegram успешно привязан',
                email: user.email,
                name: user.name
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: 'Не удалось привязать Telegram' 
            });
        }
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// Восстановление пароля
app.post('/api/auth/request-password-reset', (req, res) => {
    try {
        const { email } = req.body;
        
        const user = users.find(u => u.email === email);
        if (!user) {
            return res.json({ 
                success: false,
                error: 'Пользователь с таким email не найден'
            });
        }
        
        if (!user.telegram_chat_id) {
            return res.json({
                success: false,
                error: 'Telegram не привязан к аккаунту'
            });
        }
        
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Отправляем код в Telegram
        sendTelegramMessage(user.telegram_chat_id,
            `🔐 Код восстановления пароля:\n` +
            `📧 Для: ${user.email}\n` +
            `🔢 Код: ${code}\n` +
            `⏰ Действует 10 минут`
        ).then(() => {
            res.json({ 
                success: true, 
                message: 'Код отправлен в Telegram'
            });
        }).catch(error => {
            res.json({ 
                success: false,
                error: 'Ошибка отправки кода в Telegram'
            });
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// ==================== СТАТИЧЕСКИЕ СТРАНИЦЫ ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/main.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

// и другие статические страницы...

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎯 Сервер запущен на порту ${PORT}`);
    console.log(`🚀 Railway Deployment`);
    console.log(`✅ API доступно по: /api/health`);
});
