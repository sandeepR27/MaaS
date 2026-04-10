const fs = require('fs');
const lamejs = require('lamejs');
global.MPEGMode = require('lamejs/src/js/MPEGMode');
global.Lame = require('lamejs/src/js/Lame');
global.BitStream = require('lamejs/src/js/BitStream');

// Create dummy 1 sec 24kHz sine wave
const pcmBuffer = Buffer.alloc(48000); 
for (let i = 0; i < 24000; i++) {
  const sample = Math.floor(Math.sin(i * Math.PI * 2 * 440 / 24000) * 32767);
  pcmBuffer.writeInt16LE(sample, i * 2);
}

const samples = new Int16Array(
  pcmBuffer.buffer,
  pcmBuffer.byteOffset,
  pcmBuffer.byteLength / 2
);

const mp3encoder = new lamejs.Mp3Encoder(1, 24000, 128); // 128kbps
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
if (endBuf.length > 0) {
  mp3Data.push(Buffer.from(endBuf));
}

const mp3Buffer = Buffer.concat(mp3Data);
console.log("MP3 encoded! Length:", mp3Buffer.length);
fs.writeFileSync('test.mp3', mp3Buffer);
