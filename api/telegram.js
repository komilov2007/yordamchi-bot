const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OWNER_TELEGRAM_ID = Number(process.env.OWNER_TELEGRAM_ID);

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function telegram(method, body = {}) {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    console.error(`Telegram API error [${method}]`, data);
    throw new Error(data.description || `Telegram API error in ${method}`);
  }

  return data.result;
}

async function getBusinessConnection(businessConnectionId) {
  return telegram('getBusinessConnection', {
    business_connection_id: businessConnectionId,
  });
}

async function readBusinessMessage({
  businessConnectionId,
  chatId,
  messageId,
}) {
  return telegram('readBusinessMessage', {
    business_connection_id: businessConnectionId,
    chat_id: chatId,
    message_id: messageId,
  });
}

async function sendBusinessMessage({
  businessConnectionId,
  chatId,
  text,
  replyToMessageId,
  messageThreadId,
}) {
  const body = {
    business_connection_id: businessConnectionId,
    chat_id: chatId,
    text,
  };

  if (replyToMessageId) {
    body.reply_parameters = {
      message_id: replyToMessageId,
    };
  }

  if (messageThreadId) {
    body.message_thread_id = messageThreadId;
  }

  return telegram('sendMessage', body);
}

async function sendBusinessChatAction({
  businessConnectionId,
  chatId,
  action = 'typing',
  messageThreadId,
}) {
  const body = {
    business_connection_id: businessConnectionId,
    chat_id: chatId,
    action,
  };

  if (messageThreadId) {
    body.message_thread_id = messageThreadId;
  }

  return telegram('sendChatAction', body);
}

async function askGroq(userText) {
  try {
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
          temperature: 0.6,
          messages: [
            {
              role: 'system',
              content:
                "Sen Komilovning shaxsiy AI yordamchisisan. Faqat o'zbek tilida yoz. Javoblar qisqa, aniq, muloyim va tushunarli bo'lsin.",
            },
            {
              role: 'user',
              content: userText,
            },
          ],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Groq API error:', data);
      return "Kechirasiz, hozir javob berishda xatolik bo'ldi.";
    }

    return (
      data?.choices?.[0]?.message?.content?.trim() ||
      "Kechirasiz, hozir javob tayyor bo'lmadi."
    );
  } catch (error) {
    console.error('askGroq error:', error);
    return "Kechirasiz, hozir javob berishda xatolik bo'ldi.";
  }
}

function isCommand(text, command) {
  if (!text) return false;
  const normalized = text.trim().toLowerCase();
  return normalized === command || normalized.startsWith(`${command}@`);
}

module.exports = async (req, res) => {
  if (!BOT_TOKEN || !GROQ_API_KEY || !OWNER_TELEGRAM_ID) {
    return res.status(500).json({
      ok: false,
      error: 'BOT_TOKEN, GROQ_API_KEY yoki OWNER_TELEGRAM_ID topilmadi',
    });
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'Business AI webhook ishlayapti',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed',
    });
  }

  try {
    const update = req.body || {};

    // 1) BUSINESS CONNECTION UPDATE
    if (update.business_connection) {
      const bc = update.business_connection;

      if (Number(bc?.user?.id) !== OWNER_TELEGRAM_ID) {
        return res.status(200).json({ ok: true });
      }

      try {
        await telegram('sendMessage', {
          chat_id: bc.user_chat_id,
          text: bc.is_enabled
            ? '✅ Business bot muvaffaqiyatli ulandi.'
            : '⚠️ Business bot uzildi yoki o‘chirildi.',
        });
      } catch (e) {
        console.error('business_connection notify error:', e.message);
      }

      return res.status(200).json({ ok: true });
    }

    // 2) ODDIY BOT CHATLARI UCHUN
    const normalMsg = update.message;
    if (normalMsg && normalMsg.chat) {
      const chatId = normalMsg.chat.id;
      const text = normalMsg.text?.trim();

      if (!text) {
        return res.status(200).json({ ok: true });
      }

      if (normalMsg.from?.is_bot) {
        return res.status(200).json({ ok: true });
      }

      if (isCommand(text, '/start')) {
        await telegram('sendMessage', {
          chat_id: chatId,
          text:
            'Assalomu alaykum 👋\n' +
            'Men Komilovning AI yordamchisiman.\n' +
            'Savolingizni yozing.',
        });

        return res.status(200).json({ ok: true });
      }

      if (isCommand(text, '/help')) {
        await telegram('sendMessage', {
          chat_id: chatId,
          text:
            'Menga savol yozing.\n' + 'Men qisqa va tushunarli javob beraman.',
        });

        return res.status(200).json({ ok: true });
      }

      try {
        await telegram('sendChatAction', {
          chat_id: chatId,
          action: 'typing',
        });
      } catch (e) {
        console.error('normal sendChatAction error:', e.message);
      }

      const reply = await askGroq(text);

      await telegram('sendMessage', {
        chat_id: chatId,
        text: reply,
      });

      return res.status(200).json({ ok: true });
    }

    // 3) BUSINESS MESSAGE UCHUN
    const msg = update.business_message;
    if (!msg) {
      return res.status(200).json({ ok: true });
    }

    const text = msg.text?.trim();
    const chatId = msg.chat?.id;
    const messageId = msg.message_id;
    const businessConnectionId = msg.business_connection_id;
    const messageThreadId = msg.message_thread_id;

    if (!businessConnectionId || !chatId || !messageId) {
      return res.status(200).json({ ok: true });
    }

    if (msg.from?.is_bot || msg.sender_business_bot || msg.is_from_offline) {
      return res.status(200).json({ ok: true });
    }

    if (!text) {
      return res.status(200).json({ ok: true });
    }

    const connection = await getBusinessConnection(businessConnectionId);

    if (!connection?.is_enabled) {
      return res.status(200).json({ ok: true });
    }

    if (Number(connection?.user?.id) !== OWNER_TELEGRAM_ID) {
      return res.status(200).json({ ok: true });
    }

    if (!connection?.rights?.can_reply) {
      console.error('Business botda can_reply huquqi yo‘q');
      return res.status(200).json({ ok: true });
    }

    if (connection?.rights?.can_read_messages) {
      try {
        await readBusinessMessage({
          businessConnectionId,
          chatId,
          messageId,
        });
      } catch (e) {
        console.error('readBusinessMessage error:', e.message);
      }
    }

    if (isCommand(text, '/start')) {
      await sendBusinessMessage({
        businessConnectionId,
        chatId,
        text:
          'Assalomu alaykum 👋\n' +
          'Men Komilovning shaxsiy AI yordamchisiman.\n' +
          'Savolingizni yozing.',
        replyToMessageId: messageId,
        messageThreadId,
      });

      return res.status(200).json({ ok: true });
    }

    if (isCommand(text, '/help')) {
      await sendBusinessMessage({
        businessConnectionId,
        chatId,
        text:
          'Menga savol yozing.\n' +
          'Men Komilov nomidan qisqa va tushunarli javob beraman.',
        replyToMessageId: messageId,
        messageThreadId,
      });

      return res.status(200).json({ ok: true });
    }

    try {
      await sendBusinessChatAction({
        businessConnectionId,
        chatId,
        action: 'typing',
        messageThreadId,
      });
    } catch (e) {
      console.error('business sendChatAction error:', e.message);
    }

    const reply = await askGroq(text);

    await sendBusinessMessage({
      businessConnectionId,
      chatId,
      text: reply,
      replyToMessageId: messageId,
      messageThreadId,
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ ok: true });
  }
};
