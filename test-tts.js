require('dotenv').config();
const { synthesizeSpeech } = require('./dist/lib/tts.js') || {};

async function run() {
  const env = process.env;
  const apiKey = env.GOOGLE_TTS_API_KEY || env.GEMINI_API_KEY;
  const text = "Hello world";
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({
    input: { text },
    voice: { languageCode: "en-US", name: "en-US-Neural2-D", ssmlGender: "MALE" },
    audioConfig: { audioEncoding: "MP3", speakingRate: 1.0, pitch: 0 }
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    console.log("Status:", res.status);
    if (!res.ok) {
        console.log("Error:", await res.text());
    } else {
        console.log("Success!");
    }
  } catch(e) {
    console.log(e);
  }
}

run();
