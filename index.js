require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const jsQR = require('jsqr');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { exec } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpegPath = ffmpegInstaller.path;
const googleTTS = require('google-tts-api');

// ==========================================
// CONFIGURATION DE L'IA GEMINI
// ==========================================
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  apiVersion: 'v1beta'
});

// ==========================================
// FICHIERS DE BASE DE DONNÉES & DOSSIERS
// ==========================================
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const QR_DIR = path.join(__dirname, 'qrcodes');
const VIDEO_DIR = path.join(__dirname, 'videos');
const DB_FILE = path.join(__dirname, 'products.json');
const COOP_FILE = path.join(__dirname, 'cooperatives.json');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true });
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf8');

// Initialisation par défaut de cooperatives.json
if (!fs.existsSync(COOP_FILE)) {
  const initialCooperatives = [
    { coopId: 'COOP_01', name: 'Sahara Artisans', managerName: 'Ahmed', phone: '212640603618', altPhone: '4003010207755', city: 'Laâyoune', region: 'Laâyoune-Sakia El Hamra', specialty: 'Cuir et bijoux traditionnels' },
    { coopId: 'COOP_02', name: 'Coopérative Al Loubna', managerName: 'Loubna', phone: '212665754652', altPhone: '5450699383036', city: 'Marrakech', region: 'Marrakech-Safi', specialty: 'Argan et cosmétiques bio' },
    { coopId: 'COOP_03', name: 'Coopérative Wafa', managerName: 'Wafa', phone: '212658709673', altPhone: '139126976311398', city: 'Taroudant', region: 'Souss-Massa', specialty: 'Broderie et tissage' },
    { coopId: 'COOP_04', name: 'Coopérative Sara', managerName: 'Sara', phone: '212656682634', altPhone: '117476398469215', city: 'Casablanca', region: 'Casablanca-Settat', specialty: 'Maroquinerie' },
    { coopId: 'COOP_05', name: 'Coopérative Aymen', managerName: 'Aymen', phone: '160271100293227', altPhone: null, city: 'Rabat', region: 'Rabat-Salé-Kénitra', specialty: 'Tapis rbati' },
    { coopId: 'COOP_06', name: 'Coopérative Khawla', managerName: 'Khawla', phone: '212600000000', altPhone: '185298478706709', city: 'Taza', region: 'Fès-Meknès', specialty: 'Poterie' }
  ];
  fs.writeFileSync(COOP_FILE, JSON.stringify(initialCooperatives, null, 2), 'utf8');
}

function findCooperativeByPhone(phone) {
  try {
    const list = JSON.parse(fs.readFileSync(COOP_FILE, 'utf8'));
    return list.find((c) => c.phone === phone || c.altPhone === phone) || null;
  } catch (e) {
    console.error('Erreur lecture cooperatives.json :', e.message);
    return null;
  }
}

// ==========================================
// TEXTES MULTILINGUES (AVEC HASSANYA)
// ==========================================
const MESSAGES = {
  access_denied: {
    fr: (name, phone) => `⛔ *Accès refusé*\n\nDésolé *${name}*, le numéro (+${phone}) n'est pas autorisé.`,
    ar: (name, phone) => `⛔ *الدخول مرفوض*\n\nعذراً *${name}*، الرقم (+${phone}) غير مسجل معنا.`,
    darija: (name, phone) => `⛔ *ممنوع*\n\nسمح لينا أ *${name}*، النمرة (+${phone}) ما مسجلاش فالتعاونيات.`,
    hassania: (name, phone) => `⛔ *ممنوع الدخول*\n\nاسمح لنا يا *${name}*، ذا الرقم (+${phone}) ما هو مسجل فتعاونياتنا.`
  },
  welcome_publish: {
    fr: (name, coop, city) =>
      `Salam *${name}* 👋 (${coop} - ${city})\n\n` +
      `Envoyez la photo du produit.\n` +
      `Dès que vous avez envoyé l'image, tapez *FIN* (ou *صافي*).`,
    ar: (name, coop, city) =>
      `السلام عليكم *${name}* 👋 (${coop} - ${city})\n\n` +
      `أرسل صورة المنتج الآن.\n` +
      `عند الانتهاء اكتب *صافي* أو *FIN*.`,
    darija: (name, coop, city) =>
      `السلام عليكم أ *${name}* 👋 (${coop} - ${city})\n\n` +
      `صيفط تصويرة السلعة دابا.\n` +
      `ملي تسالي كتب *صافي* باش نكملو.`,
    hassania: (name, coop, city) =>
      `مرحبتي بك يا *${name}* 👋 (${coop} - ${city})\n\n` +
      `صيفط تصويرة ذي السلعة درك.\n` +
      `إيلا كملت كتب *وفيت* (والا *صافي*).`
  },
  cancel_ok: {
    fr: () => `❌ Opération annulée. Tapez *PUBLIER* pour recommencer.`,
    ar: () => `❌ تم الإلغاء. اكتب *نشر* للبدء من جديد.`,
    darija: () => `❌ تلاغات. كتب *PUBLIER* باش تعاود.`,
    hassania: () => `❌ التغى كل شي. اكتب *نشر* باش تبدا من جديد.`
  },
  ask_name: {
    fr: (suggest) => `1️⃣ Quel est le *nom du produit* ?\n\n💡 _Suggestion IA :_ *${suggest}*\n(Envoyez *1* pour valider ou écrivez votre propre nom).`,
    ar: (suggest) => `1️⃣ ما هو *اسم المنتج* ؟\n\n💡 _اقتراح الذكاء الاصطناعي :_ *${suggest}*\n(أرسل *1* للموافقة أو اكتب اسماً آخر).`,
    darija: (suggest) => `1️⃣ شنو هي *سمية السلعة* ؟\n\n💡 _اقتراح الذكاء الاصطناعي :_ *${suggest}*\n(كتب *1* باش تقبل هاد السمية ولا كتب سمية أخرى).`,
    hassania: (suggest) => `1️⃣ واش هو *اسم ذي البضاعة* ؟\n\n💡 _اقتراح الذكاء الاصطناعي :_ *${suggest}*\n(اكتب *1* للموافقة والا اكتب اسم من عندك).`
  },
  ask_price: {
    fr: (name) => `Nom validé : *${name}*\n\n2️⃣ Quel est le *prix* en Dirhams (DH) ? (ex: 120)`,
    ar: (name) => `تم تثبيت الاسم : *${name}*\n\n2️⃣ كم *الثمن* بالدرهم ؟ (مثال: 120)`,
    darija: (name) => `السمية : *${name}*\n\n2️⃣ شحال *الثمن* بالدرهم (DH) ؟ (مثال: 120)`,
    hassania: (name) => `الاسم مثبت : *${name}*\n\n2️⃣ بكم *السعر* بالدرهم (DH) ؟ (مثال: 120)`
  },
  ask_desc: {
    fr: (price, suggest) => `Prix : *${price} DH*\n\n3️⃣ *Description du produit :*\n\n💡 _Proposition IA :_\n"${suggest}"\n\n👉 Tapez *1* pour valider ou écrivez la vôtre :`,
    ar: (price, suggest) => `الثمن : *${price} درهم*\n\n3️⃣ *وصف المنتج :*\n\n💡 _اقتراح الذكاء الاصطناعي :_\n"${suggest}"\n\n👉 اكتب *1* لاعتماد هذا الوصف، أو اكتب وصفك الخاص :`,
    darija: (price, suggest) => `الثمن : *${price} DH*\n\n3️⃣ *الوصف ديال السلعة :*\n\n💡 _اقتراح الذكاء الاصطناعي :_\n"${suggest}"\n\n👉 كتب *1* باش تاخد هاد الوصف، ولا كتب الوصف لي بغيتي :`,
    hassania: (price, suggest) => `السعر : *${price} DH*\n\n3️⃣ *نعت ذي البضاعة (الوصف) :*\n\n💡 _اقتراح الذكاء الاصطناعي :_\n"${suggest}"\n\n👉 اكتب *1* باش تقبض هذا الوصف، والا اكتب نعت من عندك :`
  },
  summary: {
    fr: (d) => `📋 *Récapitulatif de l'annonce :*\n\n🏢 Coopérative : *${d.cooperativeName}*\n🏷️ Nom : *${d.name}*\n💰 Prix : *${d.price} DH*\n📝 Description : ${d.description}\n\nTapez *OUI* pour confirmer la publication et générer la vidéo.`,
    ar: (d) => `📋 *ملخص المنتج :*\n\n🏢 التعاونية : *${d.cooperativeName}*\n🏷️ الاسم : *${d.name}*\n💰 الثمن : *${d.price} درهم*\n📝 الوصف : ${d.description}\n\nاكتب *نعم* للتأكيد وصناعة الفيديو والملصق.`,
    darija: (d) => `📋 *الملخص :*\n\n🏢 التعاونية : *${d.cooperativeName}*\n🏷️ السمية : *${d.name}*\n💰 الثمن : *${d.price} DH*\n📝 الوصف : ${d.description}\n\nكتب *OUI* باش نخرجو الفيديو وكود QR.`,
    hassania: (d) => `📋 *خلاصة البضاعة :*\n\n🏢 التعاونية : *${d.cooperativeName}*\n🏷️ الاسم : *${d.name}*\n💰 السعر : *${d.price} DH*\n📝 الوصف : ${d.description}\n\nاكتب *نعم* باش نعدلو الفيديو وكود QR.`
  }
};

function detectLanguage(text) {
  if (!text) return 'fr';
  const clean = text.trim().toLowerCase();

  const hassaniaWords = ['marhabti', 'marhaba', 'wafiyt', 'dork', 'zain', 'gale', 'مرحبتي', 'مرحبا', 'وفيت', 'درك', 'زين', 'ذا', 'ذي'];
  if (hassaniaWords.some((w) => clean.includes(w))) return 'hassania';

  const darijaWords = ['salam', 'salina', 'chhal', 'bghit', 'chouf', 'khoya', 'khti', 'labas', 'daba', 'wakha', 'safi', 'tbarkallah', 'mzyan'];
  if (darijaWords.some((w) => clean.includes(w))) return 'darija';

  if (/[\u0600-\u06FF]/.test(clean)) return 'ar';
  return 'fr';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGeminiWithRetry(contents, config, delay = 1000) {
  const models = [
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-flash-latest'
  ];

  for (const modelName of models) {
    try {
      console.log(`🤖 Tentative d'analyse avec : ${modelName}`);
      return await ai.models.generateContent({
        model: modelName,
        contents: contents,
        config: config
      });
    } catch (err) {
      const is503 = err.message?.includes('503') || err.message?.includes('high demand');
      const is404 = err.message?.includes('404') || err.message?.includes('not found');
      const is429 = err.message?.includes('429');

      console.warn(`⚠️ [${modelName}] Échec : ${err.message?.substring(0, 90)}...`);

      if (is503 || is404) continue;
      if (is429) {
        await sleep(delay);
        continue;
      }
    }
  }

  throw new Error('Tous les modèles Gemini sont temporairement saturés.');
}

async function analyzeProductImage(imageBuffer, mimeType, lang = 'fr') {
  try {
    const base64Data = imageBuffer.toString('base64');
    const langRules = {
      ar: 'أجب باللغة العربية الفصحى بصيغة تجارية وتسويقية جذابة.',
      darija: 'جاوب بالدارجة المغربية بأسلوب تجاري مقنع لبيع المنتج على واتساب.',
      hassania: 'جاوب باللهجة الحسانية لأهل الصحراء المغربية بأسلوب تسويقي أصيل ومحترم (مثال: مرحبتي بكم، منتوج صحراوي أصيل، صنعة متقونة).',
      fr: 'Réponds en français avec un ton commercial professionnel et vendeur.'
    };

    const prompt = `Tu es un expert marketing e-commerce pour coopératives artisanales au Maroc.
${langRules[lang] || langRules.fr}
Analyse cette image de produit et renvoie UNIQUEMENT un objet JSON valide avec :
{
  "name": "Nom attractif et court du produit",
  "description": "Description commerciale complète valorisant l'artisanat, la qualité et l'utilité (2 à 3 phrases accrocheuses)."
}`;

    const response = await callGeminiWithRetry(
      [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Data } },
            { text: prompt }
          ]
        }
      ],
      { responseMimeType: 'application/json' }
    );

    return JSON.parse(response.text);
  } catch (err) {
    console.error('Erreur Gemini :', err.message || err);
    if (lang === 'hassania') {
      return {
        name: 'منتوج صحراوي أصيل',
        description: 'صنعة صحراوية تقليدية متقونة وخياطة رفيعة، متوفر للتوصيل لكافة المدن والدفع عند الاستلام.'
      };
    }
    if (lang === 'ar' || lang === 'darija') {
      return {
        name: 'منتوج تقليدي أصيل',
        description: 'منتوج يدوي عالي الجودة مصنوع بعناية وإتقان، متوفر للتوصيل والدفع عند الاستلام.'
      };
    }
    return {
      name: 'Produit Artisanal',
      description: 'Produit artisanal authentique fait main au Maroc avec une finition soignée.'
    };
  }
}

function getAudioDuration(filePath) {
  return new Promise((resolve) => {
    const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    const cmd = `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;

    exec(cmd, (err, stdout) => {
      if (err || !stdout) {
        resolve(12);
      } else {
        const sec = parseFloat(stdout.trim());
        resolve(isNaN(sec) ? 12 : Math.ceil(sec));
      }
    });
  });
}

/**
 * Génère une vidéo MP4 interactive (720x1280) avec synthèse vocale TTS synchronisée
 */
async function generateProductVideo(inputImagePath, outputVideoPath, productData, lang = 'fr') {
  const { name, price, cooperativeName, city } = productData;
  const tempDir = path.dirname(outputVideoPath);
  const timestamp = Date.now();
  const card1Path = path.join(tempDir, `frame1_${timestamp}.png`);
  const card2Path = path.join(tempDir, `frame2_${timestamp}.png`);
  const audioPath = path.join(tempDir, `voice_${timestamp}.mp3`);

  const safeCoop = (cooperativeName || 'Coopérative').substring(0, 32);
  const safeCity = (city || 'Maroc').substring(0, 22);
  const safeName = (name || 'Produit Artisanal').substring(0, 28);
  const safePrice = `${price} DH`;

  // 1. Synthèse vocale TTS (nettoyage des caractères et limitation de longueur)
  const cleanVoiceName = safeName.replace(/[^\p{L}\p{N}\s]/gu, '').trim().substring(0, 30);

  let fullText = '';
  if (lang === 'hassania') {
    fullText = `مرحبتي بكم. اكتشفوا ${cleanVoiceName} من تعاونية ${safeCoop} بمدينة ${safeCity}. التوصيل متوفر والدفع عند الاستلام.`;
  } else if (lang === 'ar' || lang === 'darija') {
    fullText = `السلام عليكم. اكتشفوا ${cleanVoiceName} من تعاونية ${safeCoop} بمدينة ${safeCity}. التوصيل متوفر والدفع عند الاستلام.`;
  } else {
    fullText = `Bonjour. Découvrez ${cleanVoiceName} de la coopérative ${safeCoop} à ${safeCity}. Livraison disponible partout au Maroc.`;
  }

  const ttsPromise = (async () => {
    try {
      const ttsLang = (lang === 'fr') ? 'fr' : 'ar';
      const cleanVoiceText = fullText.substring(0, 140).trim();

      const base64Audio = await googleTTS.getAudioBase64(cleanVoiceText, {
        lang: ttsLang,
        slow: false,
        host: 'https://translate.google.com',
        timeout: 10000
      });

      await fs.promises.writeFile(audioPath, Buffer.from(base64Audio, 'base64'));
      console.log(`🔊 [Audio TTS Réussi] Fichier audio créé : ${audioPath}`);
    } catch (err) {
      console.error('❌ [Audio TTS Erreur] :', err.message);
    }
  })();

  // 2. Préparation visuelle 720x1280
  const visualPromise = (async () => {
    const [blurredBg, productFg] = await Promise.all([
      sharp(inputImagePath)
        .resize(720, 1280, { fit: 'cover' })
        .blur(25)
        .modulate({ brightness: 0.6 })
        .png()
        .toBuffer(),
      sharp(inputImagePath)
        .resize(580, 720, { fit: 'inside' })
        .png()
        .toBuffer()
    ]);

    const svgScene1 = Buffer.from(`
    <svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg">
      <rect x="80" y="60" width="560" height="80" rx="20" fill="#111827" fill-opacity="0.9"/>
      <text x="360" y="105" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${safeCoop}</text>
      <text x="360" y="130" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#F59E0B" text-anchor="middle">📍 ${safeCity} | 100% FAIT MAIN 🇲🇦</text>

      <rect x="80" y="220" width="160" height="45" rx="22" fill="#EF4444"/>
      <text x="160" y="252" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="bold" fill="#FFFFFF" text-anchor="middle">✨ NOUVEAU</text>

      <rect x="60" y="1020" width="600" height="160" rx="25" fill="#1F2937" fill-opacity="0.95"/>
      <text x="360" y="1080" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${safeName}</text>
      <text x="360" y="1135" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#9CA3AF" text-anchor="middle">👉 Regardez la suite pour le prix...</text>
    </svg>
    `);

    const svgScene2 = Buffer.from(`
    <svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg">
      <rect x="80" y="60" width="560" height="70" rx="20" fill="#111827" fill-opacity="0.9"/>
      <text x="360" y="105" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${safeName}</text>

      <rect x="50" y="930" width="620" height="290" rx="25" fill="#111827" fill-opacity="0.96" stroke="#10B981" stroke-width="3"/>
      <rect x="235" y="965" width="250" height="70" rx="35" fill="#10B981"/>
      <text x="360" y="1012" font-family="Helvetica, Arial, sans-serif" font-size="38" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${safePrice}</text>
      <text x="360" y="1075" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#F3F4F6" text-anchor="middle">🚚 Paiement en espèces à la livraison</text>
      <rect x="110" y="1115" width="500" height="80" rx="40" fill="#25D366"/>
      <text x="360" y="1165" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="bold" fill="#FFFFFF" text-anchor="middle">💬 ENVOYER UN MESSAGE</text>
    </svg>
    `);

    await Promise.all([
      sharp(blurredBg).composite([{ input: productFg, gravity: 'center' }, { input: svgScene1, top: 0, left: 0 }]).png().toFile(card1Path),
      sharp(blurredBg).composite([{ input: productFg, gravity: 'center' }, { input: svgScene2, top: 0, left: 0 }]).png().toFile(card2Path)
    ]);
  })();

  // Attendre la fin du téléchargement audio ET des images
  await Promise.all([ttsPromise, visualPromise]);

  // 3. Calcul de la durée en fonction de l'audio
  const hasAudio = fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000;
  console.log(`🎙️ [Vérification Audio] hasAudio = ${hasAudio}`);

  let totalDuration = 10;
  if (hasAudio) {
    const detectedDuration = await getAudioDuration(audioPath);
    totalDuration = Math.max(8, detectedDuration + 1);
  }

  const sceneDuration = totalDuration / 2;
  const framesPerScene = Math.round(sceneDuration * 25);

  return new Promise((resolve, reject) => {
    const filter = `[0:v]zoompan=z='min(zoom+0.0012,1.15)':d=${framesPerScene}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280[v0];` +
                   `[1:v]zoompan=z='if(lte(zoom,1.0),1.15,max(1.0,zoom-0.0012))':d=${framesPerScene}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280[v1];` +
                   `[v0][v1]concat=n=2:v=1:a=0[v]`;

    let cmd = `"${ffmpegPath}" -y -loop 1 -t ${sceneDuration} -i "${card1Path}" -loop 1 -t ${sceneDuration} -i "${card2Path}" `;

    if (hasAudio) {
      // 0 = carte1, 1 = carte2, 2 = audioPath.
      // -map "[v]" pour la vidéo assemblée, -map 2:a:0 pour la piste audio exacte
      cmd += `-i "${audioPath}" -filter_complex "${filter}" -map "[v]" -map 2:a:0 -c:a aac -ar 44100 -ac 2 -b:a 128k `;
    } else {
      cmd += `-filter_complex "${filter}" -map "[v]" `;
    }

    cmd += `-c:v libx264 -preset ultrafast -tune stillimage -crf 24 -pix_fmt yuv420p -movflags +faststart -t ${totalDuration} "${outputVideoPath}"`;

    exec(cmd, (error) => {
      // Nettoyage des cartes temporaires et de l'audio
      if (fs.existsSync(card1Path)) fs.unlinkSync(card1Path);
      if (fs.existsSync(card2Path)) fs.unlinkSync(card2Path);
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

      if (error) {
        console.error('❌ Erreur assemblage FFmpeg :', error.message);
        return reject(error);
      }
      console.log(`✅ [Vidéo avec Son prête] : ${outputVideoPath}`);
      resolve(outputVideoPath);
    });
  });
}
async function decodeQrCodeFromBuffer(imageBuffer) {
  try {
    const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    return code ? code.data : null;
  } catch (err) {
    return null;
  }
}

// ==========================================
// CONFIGURATION DU SERVEUR EXPRESS & APIS
// ==========================================
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Exposition des dossiers statiques
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/qrcodes', express.static(QR_DIR));
app.use('/videos', express.static(VIDEO_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// 1. Liste de toutes les coopératives
app.get('/api/cooperatives', (req, res) => {
  try {
    const coops = JSON.parse(fs.readFileSync(COOP_FILE, 'utf8'));
    res.json(coops);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lecture coopératives' });
  }
});

// 2. Profil d'une coopérative spécifique et ses produits
app.get('/api/cooperatives/:coopId/products', (req, res) => {
  try {
    const { coopId } = req.params;
    const coops = JSON.parse(fs.readFileSync(COOP_FILE, 'utf8'));
    const products = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

    const coop = coops.find((c) => c.coopId === coopId);
    if (!coop) return res.status(404).json({ error: 'Coopérative introuvable' });

    const host = req.get('host');
    const protocol = req.protocol;

    const coopProducts = products
      .filter((p) => p.coopId === coopId)
      .map((p) => ({
        ...p,
        imagesUrls: (p.images || []).map((img) => `${protocol}://${host}/uploads/${img}`),
        videoUrl: p.video ? `${protocol}://${host}/videos/${p.video}` : null,
        qrCodeUrl: p.qrCode ? `${protocol}://${host}/qrcodes/${p.qrCode}` : null
      }));

    res.json({
      cooperative: coop,
      totalProducts: coopProducts.length,
      products: coopProducts
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur filtre coopérative' });
  }
});

// 3. Tous les produits pour la vitrine principale
app.get('/api/products', (req, res) => {
  try {
    if (!fs.existsSync(DB_FILE)) return res.json([]);
    const products = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const coops = JSON.parse(fs.readFileSync(COOP_FILE, 'utf8'));
    const coopMap = new Map(coops.map((c) => [c.coopId, c]));

    const host = req.get('host');
    const protocol = req.protocol;

    const formatted = products.map((p) => {
      const parentCoop = coopMap.get(p.coopId);
      return {
        ...p,
        cooperativeDetails: parentCoop
          ? {
              name: parentCoop.name,
              city: parentCoop.city,
              region: parentCoop.region,
              specialty: parentCoop.specialty
            }
          : null,
        imagesUrls: (p.images || []).map((img) => `${protocol}://${host}/uploads/${img}`),
        videoUrl: p.video ? `${protocol}://${host}/videos/${p.video}` : null,
        qrCodeUrl: p.qrCode ? `${protocol}://${host}/qrcodes/${p.qrCode}` : null
      };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lecture base produits' });
  }
});

// ==========================================
// CONFIGURATION CLIENT WHATSAPP
// ==========================================
const macChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeExecutable = fs.existsSync(macChromePath) ? macChromePath : undefined;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './whatsapp_session' }),
  authTimeoutMs: 120000,
  qrMaxRetries: 5,
  puppeteer: {
    headless: true,
    ...(chromeExecutable && { executablePath: chromeExecutable }),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  }
});

const userSessions = new Map();

client.on('qr', (qr) => {
  console.log('\n--- SCANNEZ CE QR CODE ---');
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => console.log('✅ Bot WhatsApp connecté et opérationnel !'));
client.on('auth_failure', (msg) => console.error("❌ Échec d'authentification :", msg));

async function getRealPhoneNumber(msg) {
  try {
    const contact = await msg.getContact();
    if (contact && contact.number && !contact.number.startsWith('400')) return contact.number.replace(/\D/g, '');
    const chat = await msg.getChat();
    if (chat && chat.contact && chat.contact.number && !chat.contact.number.startsWith('400')) return chat.contact.number.replace(/\D/g, '');
  } catch (e) {}
  const raw = msg.author || msg.from;
  return raw.split('@')[0].replace(/\D/g, '');
}

// ==========================================
// LOGIQUE DE TRAITEMENT DES MESSAGES WHATSAPP
// ==========================================
client.on('message', async (msg) => {
  const sender = msg.from;
  const text = msg.body ? msg.body.trim() : '';
  const cleanText = text.toLowerCase();

  let userName = 'Cher partenaire';
  try {
    const contact = await msg.getContact();
    userName = contact.pushname || contact.name || 'Cher partenaire';
  } catch (e) {}

  let senderPhone = await getRealPhoneNumber(msg);
  if (senderPhone.startsWith('0') && (senderPhone.startsWith('06') || senderPhone.startsWith('07'))) {
    senderPhone = '212' + senderPhone.substring(1);
  }

  let session = userSessions.get(sender);
  const currentLang = session ? session.lang : detectLanguage(text);

  // 1. Annulation
  if (['annuler', 'إلغاء', 'cancel', 'saf blach'].includes(cleanText)) {
    userSessions.delete(sender);
    return msg.reply(MESSAGES.cancel_ok[currentLang]());
  }

  // 2. Démarrage de publication avec sélection géographique du Hassanya
  if (['publier', 'نشر', 'post', 'zid'].includes(cleanText)) {
    const coop = findCooperativeByPhone(senderPhone);
    const userLang = detectLanguage(text);

    if (!coop) {
      return msg.reply(MESSAGES.access_denied[userLang](userName, senderPhone));
    }

    const saharanCities = ['Laâyoune', 'Dakhla', 'Es-Semara', 'Guelmim', 'Boujdour', 'Tantan', 'Tarfaya'];
    const defaultLang = saharanCities.includes(coop.city) ? 'hassania' : userLang;

    userSessions.set(sender, {
      step: 'WAITING_PHOTOS',
      photos: [],
      lang: defaultLang,
      aiSuggestions: null,
      productData: {
        coopId: coop.coopId,
        cooperativeName: coop.name,
        managerName: coop.managerName,
        city: coop.city,
        region: coop.region || ''
      },
      lastActive: Date.now()
    });

    return msg.reply(MESSAGES.welcome_publish[defaultLang](userName, coop.name, coop.city));
  }

  // 3. Scan QR par un livreur (hors session)
  if (!session && msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media && media.mimetype && media.mimetype.startsWith('image/')) {
        const buffer = Buffer.from(media.data, 'base64');
        const qrContent = await decodeQrCodeFromBuffer(buffer);
        if (!qrContent) return msg.reply('⚠️ Aucun QR Code détecté sur cette photo.');

        let targetId = null;
        try {
          targetId = Number(JSON.parse(qrContent).id);
        } catch {
          targetId = Number(qrContent.replace(/\D/g, ''));
        }

        const products = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : [];
        const product = products.find((p) => p.id === targetId);

        if (!product) return msg.reply(`⚠️ Colis introuvable (#${targetId}).`);

        return msg.reply(
          `🚚 *COLIS LIVREUR IDENTIFIÉ*\n\n` +
          `📦 Réf : #${product.id}\n` +
          `🏢 Coopérative : ${product.cooperativeName}\n` +
          `🏷️ Produit : ${product.name}\n` +
          `💵 Montant à encaisser : *${product.price} DH*\n` +
          `📞 Contact : +${product.phone}`
        );
      }
    } catch (e) {
      return msg.reply("Erreur lors de la lecture de l'image.");
    }
  }

  if (!session) {
    return msg.reply(
      `Salam *${userName}* 👋\n\n` +
      `Écrivez *PUBLIER* (ou *نشر*) pour ajouter un produit avec vidéo HD et QR Code.`
    );
  }

  session.lastActive = Date.now();
  const lang = session.lang;

  // ÉTAPE 1 : RÉCEPTION DE LA PHOTO
  if (session.step === 'WAITING_PHOTOS') {
    if (msg.hasMedia) {
      const media = await msg.downloadMedia();
      if (media && media.mimetype && media.mimetype.startsWith('image/')) {
        const ext = media.mimetype.split('/')[1].split(';')[0] || 'jpg';
        const fileName = `prod_${senderPhone}_${Date.now()}.${ext}`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        const buffer = Buffer.from(media.data, 'base64');

        fs.writeFileSync(filePath, buffer);
        session.photos.push(fileName);

        const analyzingMsg = (lang === 'hassania' || lang === 'ar')
          ? '⏳ جاري تحليل الصورة بواسطة الذكاء الاصطناعي...'
          : "⏳ Analyse de l'image par l'IA en cours...";
        msg.reply(analyzingMsg);

        session.aiSuggestions = await analyzeProductImage(buffer, media.mimetype, lang);

        userSessions.set(sender, session);
        const receivedMsg = (lang === 'hassania')
          ? '📸 تم استلام الصورة. اكتب *وفيت* (أو *صافي*) للمتابعة.'
          : (lang === 'ar' ? '📸 تم استلام الصورة. اكتب *صافي* (أو *FIN*) للمتابعة.' : '📸 Photo reçue. Écrivez *FIN* (ou *صافي*) pour continuer.');
        return msg.reply(receivedMsg);
      }
    }

    const finKeywords = ['fin', 'صافي', 'صفي', 'safi', 'salina', 'وفيت', 'wafiyt', 'كملت'];
    if (finKeywords.includes(cleanText)) {
      if (session.photos.length === 0) return msg.reply('⚠️ Veuillez envoyer au moins une photo.');
      session.step = 'WAITING_NAME';
      userSessions.set(sender, session);
      return msg.reply(MESSAGES.ask_name[lang](session.aiSuggestions.name));
    }
  }

  // ÉTAPE 2 : NOM DU PRODUIT
  if (session.step === 'WAITING_NAME') {
    if (text === '1' || cleanText === 'oui' || cleanText === 'نعم') {
      session.productData.name = session.aiSuggestions.name;
    } else {
      session.productData.name = text;
    }

    session.step = 'WAITING_PRICE';
    userSessions.set(sender, session);
    return msg.reply(MESSAGES.ask_price[lang](session.productData.name));
  }

  // ÉTAPE 3 : PRIX DU PRODUIT
  if (session.step === 'WAITING_PRICE') {
    const cleanedNumber = cleanText.replace(/dh|درهم/gi, '').replace(',', '.').trim();
    const price = parseFloat(cleanedNumber);

    if (isNaN(price) || price <= 0) {
      return msg.reply('⚠️ Prix invalide. Exemple : 150');
    }

    session.productData.price = price;
    session.step = 'WAITING_DESC';
    userSessions.set(sender, session);
    return msg.reply(MESSAGES.ask_desc[lang](price, session.aiSuggestions.description));
  }

  // ÉTAPE 4 : DESCRIPTION DU PRODUIT
  if (session.step === 'WAITING_DESC') {
    if (text === '1' || cleanText === 'oui' || cleanText === 'نعم' || cleanText === 'ok' || text === '') {
      session.productData.description = session.aiSuggestions.description;
    } else if (['0', 'passer', 'لا'].includes(cleanText)) {
      session.productData.description = session.aiSuggestions.description;
    } else {
      session.productData.description = text;
    }

    session.step = 'WAITING_CONFIRMATION';
    userSessions.set(sender, session);
    return msg.reply(MESSAGES.summary[lang](session.productData));
  }

  // ÉTAPE 5 : CONFIRMATION, GÉNÉRATION QR & VIDÉO
  if (session.step === 'WAITING_CONFIRMATION') {
    if (['oui', 'نعم', 'ok', 'confirm'].includes(cleanText)) {
      try {
        const phoneForPackage = senderPhone.startsWith('400') ? '212640603618' : senderPhone;
        const productId = Date.now();

        // 1. QR Code immédiat
        const qrContent = JSON.stringify({
          id: productId,
          coopId: session.productData.coopId,
          coop: session.productData.cooperativeName,
          nom: session.productData.name,
          prix: session.productData.price,
          phone: phoneForPackage
        });
        const qrFileName = `qr_${productId}.png`;
        const qrFilePath = path.join(QR_DIR, qrFileName);
        await QRCode.toFile(qrFilePath, qrContent, { width: 450, margin: 2 });

        // 2. Sauvegarde immédiate dans products.json
        const newProduct = {
          id: productId,
          coopId: session.productData.coopId,
          cooperativeName: session.productData.cooperativeName,
          city: session.productData.city,
          region: session.productData.region,
          name: session.productData.name,
          price: session.productData.price,
          description: session.productData.description,
          phone: phoneForPackage,
          images: session.photos,
          qrCode: qrFileName,
          video: null,
          status: 'EN_ATTENTE_LIVRAISON',
          createdAt: new Date().toISOString()
        };
        const products = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : [];
        products.push(newProduct);
        fs.writeFileSync(DB_FILE, JSON.stringify(products, null, 2), 'utf8');

        // 3. Réponse instantanée au vendeur
        await msg.reply(
          `🎉 *Produit publié sur la vitrine avec succès !*\n\n` +
          `🆔 Réf : #${newProduct.id}\n` +
          `🏢 Coopérative : ${newProduct.cooperativeName}\n` +
          `🏷️ Nom : ${newProduct.name}\n` +
          `💰 Prix : ${newProduct.price} DH\n` +
          `📝 Description : ${newProduct.description}\n\n` +
          `Voici votre étiquette QR Code 👇\n_(La vidéo est en cours de création, elle arrive dans quelques secondes...)_`
        );

        // 4. Envoi du QR Code
        const qrMedia = MessageMedia.fromFilePath(qrFilePath);
        await client.sendMessage(sender, qrMedia, { caption: `🏷️ Étiquette Colis #${newProduct.id}` });

        const capturedProductData = { ...session.productData };
        const firstPhoto = session.photos[0];

        // Libération de la session du vendeur
        userSessions.delete(sender);

        // 5. Génération de la vidéo en arrière-plan
        const photoPath = path.join(UPLOAD_DIR, firstPhoto);
        const videoFileName = `video_${productId}.mp4`;
        const videoFilePath = path.join(VIDEO_DIR, videoFileName);

        try {
          await generateProductVideo(photoPath, videoFilePath, capturedProductData, lang);

          // Mise à jour de la vidéo dans products.json
          const currentProducts = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
          const idx = currentProducts.findIndex((p) => p.id === productId);
          if (idx !== -1) {
            currentProducts[idx].video = videoFileName;
            fs.writeFileSync(DB_FILE, JSON.stringify(currentProducts, null, 2), 'utf8');
          }

          // Envoi de la vidéo une fois prête
          if (fs.existsSync(videoFilePath)) {
            const videoMedia = MessageMedia.fromFilePath(videoFilePath);
            await client.sendMessage(sender, videoMedia, {
              caption: `🎬 Vidéo interactive prête pour vos Statuts WhatsApp & Reels (${capturedProductData.name})`
            });
          }
        } catch (videoErr) {
          console.error('Erreur vidéo arrière-plan :', videoErr.message);
        }

        return;
      } catch (err) {
        console.error('Erreur finale :', err);
        return msg.reply("Erreur lors de l'enregistrement final.");
      }
    }
  }
});

// ==========================================
// DÉMARRAGE DU SERVEUR
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Serveur en écoute sur http://localhost:${PORT}`);
  console.log(`🌐 Catalogue API disponible sur http://localhost:${PORT}/api/products`);
  console.log(`🏢 Liste Coopératives API sur http://localhost:${PORT}/api/cooperatives`);
  client.initialize().catch((err) => console.error("❌ Erreur WhatsApp :", err.message || err));
});