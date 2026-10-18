const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function loadContracts() {
    let contractsText = "";
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
        console.log("خطأ في قراءة العقود:", e.message);
    }
    return contractsText;
}

let SYSTEM_PROMPT = "";

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'real-estate-bot' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('QR Code generated:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ البوت شغال 24/7 ومربوط بالواتساب بنجاح ومعاه كل العقود!');
});

client.on('message', async (msg) => {
    try {
        const model = genAI.getGenerativeModel({ 
            model: 'gemini-1.5-flash',
            systemInstruction: SYSTEM_PROMPT
        });

        let promptParts = [];

        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            promptParts.push({
                inlineData: { data: media.data, mimeType: media.mimetype }
            });
            promptParts.push(msg.body || "اشرحلي البند ده قانونياً وكيف أرد على العميل استناداً للعقود.");
        } else {
            promptParts.push(msg.body);
        }

        const result = await model.generateContent(promptParts);
        const responseText = result.response.text();

        await msg.reply(responseText);
    } catch (err) {
        console.error("خطأ في المعالجة:", err);
    }
});

async function startApp() {
    console.log("جاري قراءة العقود وتجهيز النظام...");
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

    client.initialize();
}

startApp();
