const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!BOT_TOKEN || !GROQ_API_KEY) {
  console.log('BOT_TOKEN yoki GROQ_API_KEY topilmadi');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// users.json yo‘q bo‘lsa avtomatik yaratadi
if (!fs.existsSync('users.json')) {
  fs.writeFileSync('users.json', '[]');
}

// users.json o‘qish
function readUsers() {
  return JSON.parse(fs.readFileSync('users.json'));
}

// users.json saqlash
function saveUsers(users) {
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
}

// yangi user qo‘shish
function addUser(user) {
  const users = readUsers();

  const exists = users.find((u) => u.id === user.id);

  if (!exists) {
    users.push(user);
    saveUsers(users);
  }
}

// START komandasi
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  const userData = {
    id: msg.from.id,
    name: msg.from.first_name,
    username: msg.from.username || null,
  };

  addUser(userData);

  bot.sendMessage(
    chatId,
    "Assalomu alaykum 👋\nMen Komilov's AI 🤖\nSavolingizni yozing."
  );
});

// SAVOL-JAVOB qismi
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;
  if (text.startsWith('/start')) return;

  try {
    await bot.sendChatAction(chatId, 'typing');

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content:
                "Sen Komilov's AI botsan. O‘zbek tilida qisqa va tushunarli javob ber.",
            },
            {
              role: 'user',
              content: text,
            },
          ],
        }),
      }
    );

    const data = await response.json();

    const reply =
      data?.choices?.[0]?.message?.content || 'Javob olishda xatolik bo‘ldi.';

    bot.sendMessage(chatId, reply);
  } catch (error) {
    console.log(error);
    bot.sendMessage(chatId, 'Xatolik yuz berdi.');
  }
});

console.log("Komilov's AI bot ishladi 🚀");
