const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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
    authStrategy: new LocalAuth({ dataPath: './session' }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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
        let contents = [SYSTEM_PROMPT];
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            contents.push({
                inlineData: { data: media.data, mimeType: media.mimetype }
            });
            contents.push(msg.body || "اشرحلي البند ده قانونياً وكيف أرد على العميل استناداً للعقود.");
        } else {
            contents.push(msg.body);
        }

        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: contents,
        });

        await msg.reply(response.text);
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
