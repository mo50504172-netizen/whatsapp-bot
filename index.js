const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const http = require('http');
const pdfParse = require('pdf-parse');

// ===== 1) التأكد من مفتاح Gemini =====
if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY مش موجود في Environment Variables');
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ===== 2) HTTP server بسيط (عشان الـ health check ومنع الـ Sleeping قدر الإمكان) =====
const PORT = process.env.PORT || 3000;
let botStatus = 'starting';
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Real Estate Bot - status: ${botStatus}`);
}).listen(PORT, () => console.log(`🌐 HTTP server شغال على بورت ${PORT}`));

// ===== 3) مسار تخزين الجلسة (قابل للكتابة) =====
// لو ربطت Persistent Storage في Hostless، حط مساره في Environment Variable اسمها SESSION_PATH
// مثال: SESSION_PATH=/data/.wwebjs_auth
function resolveAuthPath() {
    const candidates = [
        process.env.SESSION_PATH,
        '/data/.wwebjs_auth',
        '/tmp/.wwebjs_auth'
    ].filter(Boolean);

    for (const dir of candidates) {
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.accessSync(dir, fs.constants.W_OK);
            console.log(`📁 مسار الجلسة: ${dir}`);
            if (dir.startsWith('/tmp')) {
                console.log('⚠️ المسار مؤقت: الجلسة هتتمسح مع كل restart وهتحتاج تمسح QR تاني');
            }
            return dir;
        } catch (e) {
            console.log(`مسار غير صالح (${dir}): ${e.message}`);
        }
    }
    throw new Error('مفيش أي مسار قابل للكتابة لتخزين الجلسة');
}

const AUTH_PATH = resolveAuthPath();

// ===== 4) قراءة العقود =====
async function loadContracts() {
    let contractsText = '';
    try {
        const files = fs.readdirSync(__dirname);
        for (const file of files) {
            if (path.extname(file).toLowerCase() === '.pdf') {
                const dataBuffer = fs.readFileSync(path.join(__dirname, file));
                const pdfData = await pdfParse(dataBuffer);
                contractsText += `\n\n=== عقد مشروع (${file}) ===\n` + pdfData.text;
                console.log(`تم قراءة عقد: ${file}`);
            }
        }
    } catch (e) {
        console.log('خطأ في قراءة العقود:', e.message);
    }
    return contractsText;
}

let SYSTEM_PROMPT = '';

// ===== 5) إعداد واتساب =====
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'real-estate-bot',
        dataPath: AUTH_PATH
    }),
    puppeteer: {
        headless: true,
        // في الـ Dockerfile بنثبت Chromium ونحدد مساره هنا
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    botStatus = 'waiting for QR scan';
    console.log('QR Code generated:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('🔐 تم تسجيل الدخول'));

client.on('auth_failure', (m) => {
    botStatus = 'auth failure';
    console.error('❌ فشل المصادقة:', m);
});

client.on('disconnected', (reason) => {
    botStatus = 'disconnected';
    console.error('⚠️ البوت اتفصل:', reason);
    process.exit(1); // المنصة هتعيد التشغيل تلقائياً
});

client.on('ready', () => {
    botStatus = 'running';
    console.log('✅ البوت شغال 24/7 ومربوط بالواتساب بنجاح ومعاه كل العقود!');
});

// ===== 6) استقبال الرسائل =====
client.on('message', async (msg) => {
    try {
        // تجاهل الستاتس والجروبات
        if (msg.from === 'status@broadcast' || msg.from.endsWith('@g.us')) return;

        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: SYSTEM_PROMPT
        });

        const promptParts = [];

        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            const supported =
                media &&
                (media.mimetype.startsWith('image/') || media.mimetype === 'application/pdf');

            if (!supported) {
                await msg.reply('ابعتلي صورة البند أو ملف PDF أو اكتب سؤالك نصاً 🙏');
                return;
            }

            promptParts.push({
                inlineData: { data: media.data, mimeType: media.mimetype }
            });
            promptParts.push(
                msg.body || 'اشرحلي البند ده قانونياً وكيف أرد على العميل استناداً للعقود.'
            );
        } else {
            if (!msg.body || !msg.body.trim()) return;
            promptParts.push(msg.body);
        }

        const result = await model.generateContent(promptParts);
        const responseText = result.response.text();

        await msg.reply(responseText);
    } catch (err) {
        console.error('خطأ في المعالجة:', err);
        try {
            await msg.reply('حصلت مشكلة مؤقتة، جرب تبعت رسالتك تاني بعد شوية 🙏');
        } catch (_) {}
    }
});

// ===== 7) التشغيل =====
async function startApp() {
    console.log('جاري قراءة العقود وتجهيز النظام...');
    const contractsContent = await loadContracts();

    SYSTEM_PROMPT = `
أنت مستشار قانوني وخبير مبيعات عقارية مخصص لفريق المبيعات لدينا.
لديك معرفة كاملة ودقيقة بعقود مشاريعنا من خلال النصوص المستخرجة التالية:
${contractsContent}

عندما يسألك أي فرد من المبيعات عن اسم مشروع وبند معين، أو يرسل لك صورة بند في العقد:
1. ⚖️ **الشرح القانوني:** اشرح البند بلغة عربية مبسطة جداً بدون تعقيد، ووضح الحقوق والالتزامات استناداً لعقودنا المرفقة.
2. 🎯 **الهندلة البيعية (Objection Handling):** وضح للسيلز كيف يربط البند بمصلحة العميل، وكيف يحول الاعتراض أو الخوف لنقطة قوة وميزة إيجابية لحماية استثماره.
3. 💬 **الرد المباشر للعميل:** اكتب نص حواري جاهز ومقنع جداً يقدر السيلز يقوله أو يبعته للعميل فوراً.
`;

    await client.initialize();
}

startApp().catch((e) => {
    console.error('❌ فشل تشغيل التطبيق:', e);
    process.exit(1);
});
