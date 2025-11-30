const express = require('express');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');

// Импортируем простую БД вместо SQLite3
const SimpleDB = require('./simple-db.js');
const db = new SimpleDB();

const app = express();
const PORT = process.env.PORT || 5000; 

// Middleware
app.use(cors({
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:5000', 
            'http://127.0.0.1:5000',
            process.env.RENDER_URL,
            'https://*.onrender.com'
        ].filter(Boolean);
        
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.some(allowed => origin.includes(allowed))) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use(express.static('.'));

console.log('✅ Простая база данных инициализирована');

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Сервер работает!',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Другие страницы
app.get('/main.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/forgot-password-telegram.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'forgot-password-telegram.html'));
});

app.get('/courses.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'courses.html'));
});

app.get('/leaderboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'leaderboard.html'));
});

// Получение всех пользователей
app.get('/api/users', (req, res) => {
    res.json({ success: true, users: db.getAllUsers() });
});

// ==================== РЕГИСТРАЦИЯ ====================

// Регистрация пользователя
app.post('/api/auth/register', (req, res) => {
    const { full_name, email, password } = req.body;
    
    if (!full_name || !email || !password) {
        return res.status(400).json({
            success: false,
            error: 'Все поля обязательны для заполнения'
        });
    }
    
    // Проверяем существует ли пользователь
    const existingUser = db.findUserByEmail(email);
    if (existingUser) {
        return res.status(400).json({
            success: false,
            error: 'Пользователь с таким email уже существует'
        });
    }
    
    // Создаем пользователя
    const user = db.createUser({
        name: full_name,
        email: email,
        password: password
    });
    
    console.log('✅ Пользователь зарегистрирован:', email, 'ID:', user.id);
    
    res.json({
        success: true,
        message: 'Регистрация успешна!',
        user_id: user.id
    });
});

// Вход
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    const user = db.findUserByEmailAndPassword(email, password);
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
});

// ==================== TELEGRAM ФУНКЦИИ ====================

// Функция отправки сообщения в Telegram
async function sendTelegramMessage(chatId, message) {
    try {
        const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8522502658:AAGEDmPCiqsU8aZk5mCflXoE6HaJ06s4yoU';
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
        console.log('📤 Результат отправки в Telegram:', result);
        
        if (!result.ok) {
            throw new Error(result.description || 'Unknown Telegram error');
        }
        
        return result;
    } catch (error) {
        console.error('❌ Ошибка отправки Telegram сообщения:', error);
        throw error;
    }
}

// Упрощенные функции для Telegram (без БД)
app.post('/api/auth/request-telegram-link', (req, res) => {
    const { email } = req.body;
    
    console.log('🔗 Запрос кода привязки для:', email);
    
    const user = db.findUserByEmail(email);
    if (!user) {
        return res.status(400).json({
            success: false,
            error: 'Пользователь не найден. Сначала завершите регистрацию.'
        });
    }
    
    // Генерируем простой код
    const linkCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    console.log('✅ Код привязки сгенерирован:', linkCode, 'для пользователя:', user.email);
    
    res.json({ 
        success: true, 
        linkCode: linkCode,
        instructions: `Отправьте боту команду: /link ${linkCode}`,
        message: 'Код для привязки Telegram получен'
    });
});

app.post('/api/auth/confirm-telegram-link', (req, res) => {
    const { linkCode, telegram_chat_id } = req.body;
    
    console.log('🔗 Подтверждение привязки, код:', linkCode, 'chat_id:', telegram_chat_id);
    
    // В упрощенной версии просто подтверждаем привязку
    res.json({ 
        success: true, 
        message: 'Telegram успешно привязан',
        email: 'user@example.com',
        name: 'Пользователь'
    });
});

// Восстановление пароля (упрощенное)
app.post('/api/auth/request-password-reset', (req, res) => {
    const { email } = req.body;
    
    console.log('🔐 Запрос восстановления для:', email);
    
    const user = db.findUserByEmail(email);
    if (!user) {
        return res.json({ 
            success: false,
            error: 'Пользователь с таким email не найден'
        });
    }
    
    // Генерируем код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    console.log('✅ Код восстановления сгенерирован:', code, 'для пользователя:', user.email);
    
    res.json({ 
        success: true, 
        message: 'Код для восстановления: ' + code,
        code: code
    });
});

// Смена пароля
app.post('/api/auth/reset-password', (req, res) => {
    const { email, code, newPassword } = req.body;
    
    console.log('🔐 Смена пароля для:', email, 'код:', code);
    
    // В упрощенной версии просто меняем пароль
    const user = db.findUserByEmail(email);
    if (user) {
        user.password = newPassword;
        res.json({ 
            success: true, 
            message: 'Пароль успешно изменен' 
        });
    } else {
        res.status(400).json({ 
            success: false, 
            error: 'Пользователь не найден' 
        });
    }
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎯 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Доступно по: http://localhost:${PORT}`);
    if (process.env.RENDER_URL) {
        console.log(`🚀 Render URL: ${process.env.RENDER_URL}`);
    }
    console.log(`✅ Все API должны работать!`);
});