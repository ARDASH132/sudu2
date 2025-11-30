module.exports = {
    TELEGRAM_BOT_TOKEN: '8522502658:AAGEDmPCiqsU8aZk5mCflXoE6HaJ06s4yoU',
    SERVER_PORT: process.env.PORT || 5000,
    DATABASE_URL: process.env.DATABASE_URL,  // Используем переменную окружения для базы данных
    BOT_USERNAME: '@SUDU_Password_Bot',

    // Настройки кодов
    CODE_EXPIRY_MINUTES: 10,
    CODE_LENGTH: 6
};
