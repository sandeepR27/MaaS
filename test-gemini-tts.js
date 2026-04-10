const apiKey = process.env.GEMINI_API_KEY;
const text = "Hello world from Gemini";
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

const body = JSON.stringify({
  contents: [
    {
      role: "user",
      parts: [{ text: text }]
    }
  ],
  generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: "Puck"
        }
      }
    }
  }
});

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body
}).then(async res => {
  if (!res.ok) {
      console.log("Error:", await res.text());
  } else {
      const data = await res.json();
      const part = data.candidates[0].content.parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith('audio/'));
      if (part) {
          const pcmBuffer = Buffer.from(part.inlineData.data, 'base64');
          console.log("PCM buffer length:", pcmBuffer.length);
          
          const lamejs = require('lamejs');
          global.MPEGMode = require('lamejs/src/js/MPEGMode');
          global.Lame = require('lamejs/src/js/Lame');
          global.BitStream = require('lamejs/src/js/BitStream');
          
          const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length/2);
          const mp3encoder = new lamejs.Mp3Encoder(1, 24000, 128);
          const mp3Data = [];
          const sampleBlockSize = 1152;
          for (let i = 0; i < samples.length; i += sampleBlockSize) {
              const chunk = samples.subarray(i, i + sampleBlockSize);
              const chunkBuf = mp3encoder.encodeBuffer(chunk);
              if (chunkBuf.length > 0) {
                  mp3Data.push(Buffer.from(chunkBuf));
              }
          }
          const endBuf = mp3encoder.flush();
          if (endBuf.length > 0) mp3Data.push(Buffer.from(endBuf));
          
          const wavBuffer = Buffer.concat(mp3Data);
          console.log("MP3 encoded! Length:", wavBuffer.length);
          require('fs').writeFileSync('gemini-test.mp3', wavBuffer);
      }
  }
}).catch(console.error);
